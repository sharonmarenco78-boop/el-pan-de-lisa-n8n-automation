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
candidate.parameters.jsCode = candidate.parameters.jsCode.replace(
  '}).filter(Boolean);',
  `}).filter(Boolean).filter(i => i.json.NumeroOrden === ${JSON.stringify(orderId)});`,
);

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
