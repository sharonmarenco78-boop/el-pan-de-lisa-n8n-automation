import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = process.env.EPL_OUTPUT_PATH || resolve(here, '../dist/el-pan-de-lisa-status-reviews.json');
const outputPath = process.env.EPL_STATUS_TEST_OUTPUT_PATH || resolve(here, '../dist/el-pan-de-lisa-controlled-test.json');
const orderId = process.argv[2];
const mode = process.argv[3] || 'preparation';

if (!orderId || !['preparation', 'ready'].includes(mode)) {
  throw new Error('Usage: node build-controlled-preparation-test.mjs ORDER_ID [preparation|ready]');
}

const config = mode === 'ready'
  ? { sourceId: 'EPLReadyEmail2026', testId: 'EPLControlledReadyTest', label: 'Listo', event: 'ready_email_test_v2' }
  : { sourceId: 'EPLPrepEmail2026', testId: 'EPLControlledTest', label: 'En preparación', event: 'preparation_email_test_v2' };

const workflows = JSON.parse(readFileSync(sourcePath, 'utf8'));
const source = workflows.find((workflow) => workflow.id === config.sourceId);
if (!source) throw new Error(`${config.label} workflow not found`);

const testWorkflow = structuredClone(source);
testWorkflow.id = config.testId;
testWorkflow.name = `PRUEBA CORRECCIÓN — ${config.label} — ${orderId}`;
testWorkflow.active = false;

const trigger = testWorkflow.nodes.find((node) => node.name === 'Cada hora');
trigger.name = 'Ejecutar prueba manual';
trigger.type = 'n8n-nodes-base.manualTrigger';
trigger.typeVersion = 1;
trigger.parameters = {};
testWorkflow.connections['Ejecutar prueba manual'] = testWorkflow.connections['Cada hora'];
delete testWorkflow.connections['Cada hora'];

const candidate = testWorkflow.nodes.find((node) => node.name === 'Seleccionar envíos pendientes');
candidate.parameters.jsCode = candidate.parameters.jsCode.replace(
  '}).filter(Boolean);',
  `}).filter(Boolean).filter(i => i.json.NumeroOrden === ${JSON.stringify(orderId)});`,
);

const email = testWorkflow.nodes.find((node) => node.name === 'Enviar correo');
email.name = 'Enviar prueba de correo';
email.parameters.subject = `=PRUEBA CORRECCIÓN — ${config.label} — Pedido {{ $json.NumeroOrden }}`;
testWorkflow.connections['Seleccionar envíos pendientes'].main[0][0].node = 'Enviar prueba de correo';
testWorkflow.connections['Enviar prueba de correo'] = testWorkflow.connections['Enviar correo'];
delete testWorkflow.connections['Enviar correo'];

const logSet = testWorkflow.nodes.find((node) => node.name === 'Preparar registro');
const eventField = logSet.parameters.assignments.assignments.find((field) => field.name === 'Evento');
eventField.value = config.event;

writeFileSync(outputPath, JSON.stringify([testWorkflow], null, 2));
console.log(`Generated corrected controlled ${mode} test for ${orderId}`);
