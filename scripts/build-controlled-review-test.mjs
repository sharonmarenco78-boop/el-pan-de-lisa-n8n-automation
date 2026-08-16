import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = process.env.EPL_OUTPUT_PATH || resolve(here, '../dist/el-pan-de-lisa-status-reviews.json');
const outputPath = process.env.EPL_REVIEW_TEST_OUTPUT_PATH || resolve(here, '../dist/el-pan-de-lisa-controlled-review-test.json');
const orderId = process.argv[2];

if (!orderId) throw new Error('Usage: node build-controlled-review-test.mjs ORDER_ID');

const workflows = JSON.parse(readFileSync(sourcePath, 'utf8'));
const source = workflows.find((workflow) => workflow.id === 'EPLReviewSend026');
if (!source) throw new Error('Review workflow not found');

const testWorkflow = structuredClone(source);
testWorkflow.id = 'EPLControlledReviewTest';
testWorkflow.name = `PRUEBA CONTROLADA — Solicitud de review — ${orderId}`;
testWorkflow.active = false;

const trigger = testWorkflow.nodes.find((node) => node.name === 'Cada hora');
trigger.name = 'Ejecutar prueba manual';
trigger.type = 'n8n-nodes-base.manualTrigger';
trigger.typeVersion = 1;
trigger.parameters = {};
testWorkflow.connections['Ejecutar prueba manual'] = testWorkflow.connections['Cada hora'];
delete testWorkflow.connections['Cada hora'];

const candidate = testWorkflow.nodes.find((node) => node.name === 'Seleccionar reviews vencidos');
const formUrl = candidate.parameters.jsCode.match(/ReviewURL: '([^']+)'/)?.[1];
if (!formUrl) throw new Error('Review form URL not found in source workflow');
candidate.parameters.jsCode = `const pedidos = items.filter(i => i.json.__kind === 'pedido');
const pedido = pedidos.find(i => String(i.json['N.º de orden'] ?? '').trim() === ${JSON.stringify(orderId)});
if (!pedido || pedido.json.Estado !== 'Entregado') return [];
const order = String(pedido.json['N.º de orden']).trim();
const products = [];
if (Number(pedido.json['Cantidad Pan Blanco'] ?? 0) > 0) products.push('Pan Blanco');
if (Number(pedido.json['Cantidad Pan Semi Integral'] ?? 0) > 0) products.push('Pan Semi Integral');
const product = products.join(' + ') || 'Producto no identificado';
const query = ['usp=pp_url','entry.950326924='+encodeURIComponent(order),'entry.1893454218='+encodeURIComponent(pedido.json.Nombre ?? ''),'entry.1903981963='+encodeURIComponent(product),'entry.732910652='+encodeURIComponent(pedido.json.Correo ?? '')].join('&');
return [{ json: { ...pedido.json, NumeroOrden: order, Producto: product, ReviewURL: ${JSON.stringify(formUrl)} + '?' + query } }];`;

const email = testWorkflow.nodes.find((node) => node.name === 'Enviar solicitud de review');
email.name = 'Enviar prueba de review';
email.parameters.subject = '=PRUEBA — ¿Cómo estuvo tu pedido? — Pedido {{ $json.NumeroOrden }}';
testWorkflow.connections['Seleccionar reviews vencidos'].main[0][0].node = 'Enviar prueba de review';
testWorkflow.connections['Enviar prueba de review'] = testWorkflow.connections['Enviar solicitud de review'];
delete testWorkflow.connections['Enviar solicitud de review'];

const logSet = testWorkflow.nodes.find((node) => node.name === 'Preparar registro');
const eventField = logSet.parameters.assignments.assignments.find((field) => field.name === 'Evento');
eventField.value = 'review_request_test_v2';

writeFileSync(outputPath, JSON.stringify([testWorkflow], null, 2));
console.log(`Generated controlled review test for ${orderId}`);
