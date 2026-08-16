import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const here = dirname(fileURLToPath(import.meta.url));
const SPREADSHEET_ID = requireEnv('EPL_SPREADSHEET_ID');
const PEDIDOS_SHEET_ID = Number(requireEnv('EPL_PEDIDOS_SHEET_ID'));
const LOG_SHEET_ID = Number(requireEnv('EPL_LOG_SHEET_ID'));
const TEMPLATE_DIR = process.env.EPL_TEMPLATE_DIR || resolve(here, '../templates');
const OUTPUT_PATH = process.env.EPL_OUTPUT_PATH || resolve(here, '../dist/el-pan-de-lisa-status-reviews.json');
const REVIEW_FORM_URL = process.env.EPL_REVIEW_FORM_URL || 'https://docs.google.com/forms/d/e/REPLACE_WITH_FORM_ID/viewform';

const preparationTemplate = readFileSync(`${TEMPLATE_DIR}/1. Plantilla del correo "En preparación"_html_20260814_b4be90.html`, 'utf8');
const readyTemplate = readFileSync(`${TEMPLATE_DIR}/2. Plantilla del correo "Listo"_html_20260814_c6d0fb.html`, 'utf8');
const reviewTemplate = readFileSync(`${TEMPLATE_DIR}/Plantilla del correo de solicitud de review (actualizada)_html_20260814_7ff161.html`, 'utf8');

const sheetsCredential = {
  googleSheetsOAuth2Api: {
    name: process.env.EPL_SHEETS_CREDENTIAL_NAME || 'Google Sheets account',
  },
};

const gmailCredential = {
  gmailOAuth2: {
    name: process.env.EPL_GMAIL_CREDENTIAL_NAME || 'Gmail account',
  },
};

const documentId = {
  __rl: true,
  value: SPREADSHEET_ID,
  mode: 'list',
  cachedResultName: 'El Pan de Lisa - Control de Pedidos',
  cachedResultUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
};

const sheetRef = (value, name) => ({
  __rl: true,
  value,
  mode: 'list',
  cachedResultName: name,
  cachedResultUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${value}`,
});

const logColumns = [
  'Fecha',
  'N.º de orden',
  'Evento',
  'Estado detectado',
  'Correo',
  'Fecha envío',
  'Resultado',
  'Message ID',
  'Notas',
];

const normalizeOrderNode = (name, position) => node(
  name,
  'n8n-nodes-base.code',
  position,
  {
    jsCode: `return items.map(item => {\n  const expected = 'N.º de orden';\n  const key = Object.keys(item.json).find(candidate => candidate.normalize('NFC').trim() === expected);\n  if (!key) throw new Error('No se encontró la columna exacta N.º de orden');\n  const order = String(item.json[key] ?? '').trim();\n  if (!order) throw new Error('El pedido no contiene N.º de orden');\n  return { json: { ...item.json, [expected]: order, NumeroOrden: order } };\n});`,
  },
  { typeVersion: 2 },
);

const node = (name, type, position, parameters = {}, extra = {}) => ({
  parameters,
  type,
  typeVersion: extra.typeVersion ?? 1,
  position,
  id: randomUUID(),
  name,
  ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'typeVersion')),
});

const schedule = (position = [-900, 0]) => node(
  'Cada hora',
  'n8n-nodes-base.scheduleTrigger',
  position,
  { rule: { interval: [{ field: 'hours' }] } },
  { typeVersion: 1.3 },
);

const getRows = (name, sheetId, sheetName, position, filters = [], extra = {}) => node(
  name,
  'n8n-nodes-base.googleSheets',
  position,
  {
    documentId,
    sheetName: sheetRef(sheetId, sheetName),
    filtersUI: { values: filters },
    options: {},
  },
  {
    typeVersion: 4.7,
    credentials: sheetsCredential,
    ...extra,
  },
);

const statusFilter = (name, status, position) => node(
  name,
  'n8n-nodes-base.filter',
  position,
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{
        id: randomUUID(),
        leftValue: '={{ $json.Estado }}',
        rightValue: status,
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  },
  { typeVersion: 2.3 },
);

const noLookupResult = (name, position) => node(
  name,
  'n8n-nodes-base.if',
  position,
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: randomUUID(),
        leftValue: '={{ Object.keys($json).length }}',
        rightValue: 0,
        operator: { type: 'number', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  },
  { typeVersion: 2.2 },
);

const setFields = (name, position, fields) => node(
  name,
  'n8n-nodes-base.set',
  position,
  {
    assignments: {
      assignments: Object.entries(fields).map(([field, value]) => ({
        id: randomUUID(),
        name: field,
        value,
        type: 'string',
      })),
    },
    options: {},
  },
  { typeVersion: 3.4 },
);

const appendLog = (name, position) => node(
  name,
  'n8n-nodes-base.googleSheets',
  position,
  {
    operation: 'append',
    documentId,
    sheetName: sheetRef(LOG_SHEET_ID, 'Automation Log'),
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(logColumns.map((column) => [
        column,
        column === 'N.º de orden'
          ? '={{ $json.NumeroOrden || $json["N.º de orden"] || "" }}'
          : `={{ $json[${JSON.stringify(column)}] }}`,
      ])),
      matchingColumns: [],
      schema: logColumns.map((column) => ({
        id: column,
        displayName: column,
        required: false,
        defaultMatch: false,
        display: true,
        type: 'string',
        canBeUsedToMatch: true,
      })),
      attemptToConvertTypes: false,
      convertFieldsToString: false,
    },
    options: {},
  },
  { typeVersion: 4.7, credentials: sheetsCredential },
);

const templateForSource = (html, sourceNode) => html
  .replaceAll('{{ $json', `{{ $('${sourceNode}').item.json`)
  .replaceAll(`$('${sourceNode}').item.json['N.º de orden']`, `$('${sourceNode}').item.json.NumeroOrden`);

const gmail = (name, position, sourceNode, subject, html) => node(
  name,
  'n8n-nodes-base.gmail',
  position,
  {
    sendTo: `={{ $('${sourceNode}').item.json.Correo }}`,
    subject,
    emailType: 'html',
    message: `=${templateForSource(html, sourceNode)}`,
    options: {},
  },
  {
    typeVersion: 2.2,
    credentials: gmailCredential,
    onError: 'continueRegularOutput',
  },
);

const logResultFields = (sourceNode, eventName) => ({
  Fecha: '={{ $now.toISO() }}',
  'N.º de orden': `={{ $('${sourceNode}').item.json['N.º de orden'] }}`,
  Evento: eventName,
  'Estado detectado': `={{ $('${sourceNode}').item.json.Estado }}`,
  Correo: `={{ $('${sourceNode}').item.json.Correo }}`,
  'Fecha envío': '={{ $json.error ? "" : $now.toISO() }}',
  Resultado: '={{ $json.error ? "Error" : "Enviado" }}',
  'Message ID': '={{ $json.id || $json.messageId || "" }}',
  Notas: '={{ $json.error ? ($json.error.message || JSON.stringify($json.error)) : "" }}',
});

const lookupSent = (name, position, sourceNode, eventName) => getRows(
  name,
  LOG_SHEET_ID,
  'Automation Log',
  position,
  [
    { lookupColumn: 'N.º de orden', lookupValue: `={{ $('${sourceNode}').item.json['N.º de orden'] }}` },
    { lookupColumn: 'Evento', lookupValue: eventName },
    { lookupColumn: 'Resultado', lookupValue: 'Enviado' },
  ],
  { alwaysOutputData: true },
);

const connect = (target) => ({ main: [[{ node: target, type: 'main', index: 0 }]] });

const tagItems = (name, kind, position) => node(name, 'n8n-nodes-base.code', position, {
  jsCode: `return items.map(item => ({ json: { ...item.json, __kind: '${kind}' } }));`,
}, { typeVersion: 2 });

const mergeAppend = (name, position) => node(name, 'n8n-nodes-base.merge', position, {
  mode: 'append',
}, { typeVersion: 3.2 });

const workflowBase = (name, nodes, connections) => ({
  name,
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/El_Salvador' },
  versionId: randomUUID(),
  meta: { templateCredsSetupCompleted: true },
  tags: [],
});

const directTemplate = (html) => html.replaceAll("$json['N.º de orden']", '$json.NumeroOrden');

const logResultFromCandidates = (candidateNode, eventName) => ({
  Fecha: '={{ $now.toISO() }}',
  NumeroOrden: `={{ $('${candidateNode}').all()[$itemIndex].json.NumeroOrden }}`,
  'N.º de orden': `={{ $('${candidateNode}').all()[$itemIndex].json.NumeroOrden }}`,
  Evento: eventName,
  'Estado detectado': `={{ $('${candidateNode}').all()[$itemIndex].json.Estado }}`,
  Correo: `={{ $('${candidateNode}').all()[$itemIndex].json.Correo }}`,
  'Fecha envío': '={{ $json.error ? "" : $now.toISO() }}',
  Resultado: '={{ $json.error ? "Error" : "Enviado" }}',
  'Message ID': '={{ $json.id || $json.messageId || "" }}',
  Notas: '={{ $json.error ? ($json.error.message || JSON.stringify($json.error)) : "" }}',
});

function statusEmailWorkflow({ name, status, eventName, html, subject }) {
  const candidate = 'Seleccionar envíos pendientes';
  const selectCode = `const pedidos = items.filter(i => i.json.__kind === 'pedido');\nconst logs = items.filter(i => i.json.__kind === 'log');\nconst sent = new Set(logs.filter(i => i.json.Evento === '${eventName}' && i.json.Resultado === 'Enviado').map(i => String(i.json['N.º de orden'] ?? '').trim()));\nreturn pedidos.filter(i => i.json.Estado === '${status}').map(i => {\n  const key = Object.keys(i.json).find(k => k.normalize('NFC').trim() === 'N.º de orden');\n  const order = String(key ? i.json[key] : '').trim();\n  if (!order || sent.has(order)) return null;\n  const json = { ...i.json, 'N.º de orden': order, NumeroOrden: order };\n  delete json.__kind;\n  return { json };\n}).filter(Boolean);`;
  const nodes = [
    schedule([-1000, 0]),
    getRows('Leer Pedidos', PEDIDOS_SHEET_ID, 'Pedidos', [-780, -140]),
    tagItems('Marcar Pedidos', 'pedido', [-560, -140]),
    getRows('Leer Automation Log', LOG_SHEET_ID, 'Automation Log', [-780, 140], [], { alwaysOutputData: true }),
    tagItems('Marcar Log', 'log', [-560, 140]),
    mergeAppend('Unir Pedidos y Log', [-340, 0]),
    node(candidate, 'n8n-nodes-base.code', [-120, 0], { jsCode: selectCode }, { typeVersion: 2 }),
    node('Enviar correo', 'n8n-nodes-base.gmail', [120, 0], {
      sendTo: '={{ $json.Correo }}',
      subject,
      emailType: 'html',
      message: `=${directTemplate(html)}`,
      options: {},
    }, { typeVersion: 2.2, credentials: gmailCredential, onError: 'continueRegularOutput' }),
    setFields('Preparar registro', [360, 0], logResultFromCandidates(candidate, eventName)),
    appendLog('Registrar resultado', [600, 0]),
  ];
  return workflowBase(name, nodes, {
    'Cada hora': { main: [[{ node: 'Leer Pedidos', type: 'main', index: 0 }, { node: 'Leer Automation Log', type: 'main', index: 0 }]] },
    'Leer Pedidos': connect('Marcar Pedidos'),
    'Marcar Pedidos': { main: [[{ node: 'Unir Pedidos y Log', type: 'main', index: 0 }]] },
    'Leer Automation Log': connect('Marcar Log'),
    'Marcar Log': { main: [[{ node: 'Unir Pedidos y Log', type: 'main', index: 1 }]] },
    'Unir Pedidos y Log': connect(candidate),
    [candidate]: connect('Enviar correo'),
    'Enviar correo': connect('Preparar registro'),
    'Preparar registro': connect('Registrar resultado'),
  });
}

function reviewQueueWorkflow() {
  const candidate = 'Seleccionar entregados nuevos';
  const selectCode = `const pedidos = items.filter(i => i.json.__kind === 'pedido');\nconst logs = items.filter(i => i.json.__kind === 'log');\nconst existing = new Set(logs.filter(i => i.json.Evento === 'review_request' && ['Pendiente','Enviado'].includes(i.json.Resultado)).map(i => String(i.json['N.º de orden'] ?? '').trim()));\nreturn pedidos.filter(i => i.json.Estado === 'Entregado').map(i => {\n  const key = Object.keys(i.json).find(k => k.normalize('NFC').trim() === 'N.º de orden');\n  const order = String(key ? i.json[key] : '').trim();\n  if (!order || existing.has(order)) return null;\n  return { json: { Fecha: new Date().toISOString(), 'N.º de orden': order, Evento: 'review_request', 'Estado detectado': 'Entregado', Correo: i.json.Correo ?? '', 'Fecha envío': '', Resultado: 'Pendiente', 'Message ID': '', Notas: 'Esperando 48 horas antes de solicitar review' } };\n}).filter(Boolean);`;
  const nodes = [
    schedule([-1000, 0]),
    getRows('Leer Pedidos', PEDIDOS_SHEET_ID, 'Pedidos', [-780, -140]),
    tagItems('Marcar Pedidos', 'pedido', [-560, -140]),
    getRows('Leer Automation Log', LOG_SHEET_ID, 'Automation Log', [-780, 140], [], { alwaysOutputData: true }),
    tagItems('Marcar Log', 'log', [-560, 140]),
    mergeAppend('Unir Pedidos y Log', [-340, 0]),
    node(candidate, 'n8n-nodes-base.code', [-120, 0], { jsCode: selectCode }, { typeVersion: 2 }),
    appendLog('Registrar espera', [120, 0]),
  ];
  return workflowBase('El Pan de Lisa — Programar review 48h', nodes, {
    'Cada hora': { main: [[{ node: 'Leer Pedidos', type: 'main', index: 0 }, { node: 'Leer Automation Log', type: 'main', index: 0 }]] },
    'Leer Pedidos': connect('Marcar Pedidos'),
    'Marcar Pedidos': { main: [[{ node: 'Unir Pedidos y Log', type: 'main', index: 0 }]] },
    'Leer Automation Log': connect('Marcar Log'),
    'Marcar Log': { main: [[{ node: 'Unir Pedidos y Log', type: 'main', index: 1 }]] },
    'Unir Pedidos y Log': connect(candidate),
    [candidate]: connect('Registrar espera'),
  });
}

function reviewSenderWorkflow() {
  const candidate = 'Seleccionar reviews vencidos';
  const selectCode = `const pedidos = items.filter(i => i.json.__kind === 'pedido');\nconst logs = items.filter(i => i.json.__kind === 'log');\nconst sent = new Set(logs.filter(i => i.json.Evento === 'review_request' && i.json.Resultado === 'Enviado').map(i => String(i.json['N.º de orden'] ?? '').trim()));\nconst cutoff = Date.now() - 48 * 60 * 60 * 1000;\nconst pending = logs.filter(i => i.json.Evento === 'review_request' && i.json.Resultado === 'Pendiente' && Date.parse(i.json.Fecha) <= cutoff);\nconst byOrder = new Map(pedidos.map(i => [String(i.json['N.º de orden'] ?? '').trim(), i.json]));\nreturn pending.map(i => {\n  const order = String(i.json['N.º de orden'] ?? '').trim();\n  const pedido = byOrder.get(order);\n  if (!pedido || pedido.Estado !== 'Entregado' || sent.has(order)) return null;\n  const products = [];\n  if (Number(pedido['Cantidad Pan Blanco'] ?? 0) > 0) products.push('Pan Blanco');\n  if (Number(pedido['Cantidad Pan Semi Integral'] ?? 0) > 0) products.push('Pan Semi Integral');\n  const product = products.join(' + ') || 'Producto no identificado';\n  const query = ['usp=pp_url','entry.950326924='+encodeURIComponent(order),'entry.1893454218='+encodeURIComponent(pedido.Nombre ?? ''),'entry.1903981963='+encodeURIComponent(product),'entry.732910652='+encodeURIComponent(pedido.Correo ?? '')].join('&');\n  return { json: { ...pedido, NumeroOrden: order, Producto: product, ReviewURL: 'https://docs.google.com/forms/d/e/1FAIpQLScYEs0m7KKzOouSuusR3J8We8x-paIGs-VkAllDQaBMW6c4Ig/viewform?' + query } };\n}).filter(Boolean);`;
  const configuredSelectCode = selectCode.replace(
    'https://docs.google.com/forms/d/e/1FAIpQLScYEs0m7KKzOouSuusR3J8We8x-paIGs-VkAllDQaBMW6c4Ig/viewform',
    REVIEW_FORM_URL,
  );
  const reviewHtml = directTemplate(reviewTemplate).replace('__REVIEW_URL__', '{{ $json.ReviewURL }}');
  const nodes = [
    schedule([-1000, 0]),
    getRows('Leer Pedidos', PEDIDOS_SHEET_ID, 'Pedidos', [-780, -140]),
    tagItems('Marcar Pedidos', 'pedido', [-560, -140]),
    getRows('Leer Automation Log', LOG_SHEET_ID, 'Automation Log', [-780, 140], [], { alwaysOutputData: true }),
    tagItems('Marcar Log', 'log', [-560, 140]),
    mergeAppend('Unir Pedidos y Log', [-340, 0]),
    node(candidate, 'n8n-nodes-base.code', [-120, 0], { jsCode: configuredSelectCode }, { typeVersion: 2 }),
    node('Enviar solicitud de review', 'n8n-nodes-base.gmail', [120, 0], {
      sendTo: '={{ $json.Correo }}',
      subject: '=¿Cómo estuvo tu pedido? — Pedido {{ $json.NumeroOrden }}',
      emailType: 'html',
      message: `=${reviewHtml}`,
      options: {},
    }, { typeVersion: 2.2, credentials: gmailCredential, onError: 'continueRegularOutput' }),
    setFields('Preparar registro', [360, 0], logResultFromCandidates(candidate, 'review_request')),
    appendLog('Registrar resultado', [600, 0]),
  ];
  return workflowBase('El Pan de Lisa — Enviar solicitud de review', nodes, {
    'Cada hora': { main: [[{ node: 'Leer Pedidos', type: 'main', index: 0 }, { node: 'Leer Automation Log', type: 'main', index: 0 }]] },
    'Leer Pedidos': connect('Marcar Pedidos'),
    'Marcar Pedidos': { main: [[{ node: 'Unir Pedidos y Log', type: 'main', index: 0 }]] },
    'Leer Automation Log': connect('Marcar Log'),
    'Marcar Log': { main: [[{ node: 'Unir Pedidos y Log', type: 'main', index: 1 }]] },
    'Unir Pedidos y Log': connect(candidate),
    [candidate]: connect('Enviar solicitud de review'),
    'Enviar solicitud de review': connect('Preparar registro'),
    'Preparar registro': connect('Registrar resultado'),
  });
}

const workflows = [
  statusEmailWorkflow({
    name: 'El Pan de Lisa — Correo pedido en preparación',
    status: 'En preparación',
    eventName: 'preparation_email',
    html: preparationTemplate,
    subject: '=Tu pedido está en preparación — Pedido {{ $json.NumeroOrden }}',
  }),
  statusEmailWorkflow({
    name: 'El Pan de Lisa — Correo pedido listo',
    status: 'Listo',
    eventName: 'ready_email',
    html: readyTemplate,
    subject: '=Tu pedido está listo — Pedido {{ $json.NumeroOrden }}',
  }),
  reviewQueueWorkflow(),
  reviewSenderWorkflow(),
];

const workflowIds = [
  'EPLPrepEmail2026',
  'EPLReadyEmail2026',
  'EPLReviewQueue026',
  'EPLReviewSend026',
];

workflows.forEach((workflow, index) => {
  workflow.id = workflowIds[index];
});

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(workflows, null, 2));
console.log(`Generated ${workflows.length} inactive workflows.`);
