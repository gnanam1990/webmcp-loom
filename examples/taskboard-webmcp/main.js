import {
  createWebMcpToolProvider,
  installDocumentRuntimeTools,
  runAgentRuntime,
} from '../../packages/runtime/dist/index.js';
import { createTaskBoard, createTaskBoardTools } from './taskboard.js';

const board = createTaskBoard();
const tools = createTaskBoardTools(board);
const boardList = document.querySelector('#tasks');
const revision = document.querySelector('#revision');
const status = document.querySelector('#status');
const trace = document.querySelector('#trace');
const handoff = document.querySelector('#handoff');
const stage = document.querySelector('#stage');
const humanEdit = document.querySelector('#human-edit');
const stale = document.querySelector('#stale');

/** Renders the page-owned board state without trusting model output as HTML. */
function render() {
  const snapshot = board.getSnapshot();
  revision.textContent = `Revision ${snapshot.revision}`;
  boardList.replaceChildren(...snapshot.tasks.map((task) => {
    const item = document.createElement('li');
    item.textContent = task.title;
    return item;
  }));
  if (snapshot.tasks.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No tasks staged yet.';
    item.className = 'empty';
    boardList.append(item);
  }
}

/** Creates a deterministic demo model that reads before proposing a write. */
function scriptFor(title) {
  let step = 0;
  return {
    generate: async (request) => {
      step += 1;
      if (step === 1) return JSON.stringify({ type: 'tool_call', tool: 'get_task_board', input: {} });
      if (step === 2) {
        const expectedRevision = Number(/^Current state revision:\s*(\d+)$/m.exec(request.prompt)?.[1]);
        return JSON.stringify({ type: 'tool_call', tool: 'stage_task', input: { expectedRevision, title } });
      }
      return JSON.stringify({ type: 'final', message: 'Task-board flow complete.' });
    },
  };
}

/** Displays the runtime result and its event trace. */
function show(result) {
  status.textContent = result.status.replaceAll('_', ' ');
  status.dataset.state = result.status;
  trace.textContent = JSON.stringify(result.events, null, 2);
  render();
}

/** Runs the runtime against the document-facing WebMCP tool registry. */
async function start(context, approve, onEvent = undefined) {
  const provider = createWebMcpToolProvider(context, {
    fromOrigins: [document.location.origin],
    trustedReadOnlyOrigins: [document.location.origin],
  });
  const result = await runAgentRuntime({
    goal: 'Read this board and stage the WebMCP review task.',
    model: scriptFor('Review the runtime’s shared WebMCP surface'),
    toolProvider: provider,
    getStateRevision: () => board.getSnapshot().revision,
    ...(approve === undefined ? {} : { approve }),
    ...(onEvent === undefined ? {} : { onEvent }),
  });
  show(result);
}

function disableWebMcpActions() {
  handoff.disabled = true;
  stage.disabled = true;
  stale.disabled = true;
}

let installed = null;
let terminalPagehide = false;
let registrationFailed = false;
const lifecycle = new document.defaultView.AbortController();
document.defaultView?.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  terminalPagehide = true;
  lifecycle.abort();
  installed?.dispose();
});

try {
  installed = await installDocumentRuntimeTools(tools, { signal: lifecycle.signal });
  if (terminalPagehide) installed?.dispose();
} catch {
  if (!terminalPagehide) {
    registrationFailed = true;
    status.textContent = 'WebMCP registration failed';
    status.dataset.state = 'failed';
    disableWebMcpActions();
  }
}

if (installed === null && !registrationFailed && !terminalPagehide) {
  status.textContent = 'WebMCP unavailable in this browser';
  status.dataset.state = 'unsupported';
  disableWebMcpActions();
} else if (installed !== null && !terminalPagehide) {
  status.textContent = 'WebMCP tools registered';
  status.dataset.state = 'registered';
  handoff.addEventListener('click', () => start(document.modelContext));
  stage.addEventListener('click', () => start(document.modelContext, () => true));
  stale.addEventListener('click', () => {
    let edited = false;
    return start(document.modelContext, undefined, (event) => {
      if (!edited && event.type === 'tools_refreshed' && event.step === 2 && event.phase === 'pre_execute') {
        edited = true;
        board.addAsHuman('Human edit invalidated the agent plan');
      }
    });
  });
}

humanEdit.addEventListener('click', () => {
  board.addAsHuman('Human task added to the shared board');
  status.textContent = 'Human edit committed';
  status.dataset.state = 'human';
  render();
});
board.subscribe(render);
render();
