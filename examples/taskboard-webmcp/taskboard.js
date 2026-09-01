/**
 * A deliberately tiny non-travel domain used to prove runtime portability.
 *
 * The board owns its state and every write requires the revision returned by a
 * read. The same two tool definitions feed both document WebMCP registration
 * and the in-page runtime; neither entry point imports another app's state.
 */

const MAX_TASK_TITLE_CHARACTERS = 80;

export function createTaskBoard() {
  let revision = 1;
  let nextId = 1;
  /** @type {{ id: string, title: string }[]} */
  let tasks = [];
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const snapshot = () => ({
    revision,
    tasks: tasks.map((task) => ({ ...task })),
  });
  const notify = () => listeners.forEach((listener) => listener());
  const requireRevision = (expectedRevision) => {
    if (!Number.isInteger(expectedRevision)) {
      throw new Error('expectedRevision must be an integer.');
    }
    if (expectedRevision !== revision) {
      throw new Error(`Task board changed from revision ${expectedRevision} to ${revision}.`);
    }
  };
  const add = (title) => {
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TASK_TITLE_CHARACTERS) {
      throw new Error(`title must contain 1-${MAX_TASK_TITLE_CHARACTERS} characters.`);
    }
    const task = { id: `task-${nextId}`, title: title.trim() };
    nextId += 1;
    tasks = [...tasks, task];
    revision += 1;
    notify();
    return { revision, task: { ...task } };
  };

  return Object.freeze({
    getSnapshot: snapshot,
    /** Human edits do not carry a revision but still invalidate agent work. */
    addAsHuman: add,
    stage(expectedRevision, title) {
      requireRevision(expectedRevision);
      return add(title);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

/** Returns the one canonical task-board tool array for WebMCP and the runtime. */
export function createTaskBoardTools(board) {
  return Object.freeze([
    {
      name: 'get_task_board',
      title: 'Get task board',
      description: 'Read every staged task and the revision required before staging another task.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => board.getSnapshot(),
    },
    {
      name: 'stage_task',
      title: 'Stage task',
      description: 'Stage one task after an explicit human approval. Requires the revision returned by get_task_board.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 1 },
          title: { type: 'string', minLength: 1, maxLength: MAX_TASK_TITLE_CHARACTERS },
        },
        required: ['expectedRevision', 'title'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input, context) => {
        const expectedRevision = input.expectedRevision;
        if (!Number.isInteger(expectedRevision)) {
          throw new Error('expectedRevision must be an integer.');
        }
        if (context.expectedStateRevision !== undefined
          && context.expectedStateRevision !== expectedRevision) {
          throw new Error('Runtime and tool revisions disagree.');
        }
        return board.stage(expectedRevision, input.title);
      },
    },
  ]);
}
