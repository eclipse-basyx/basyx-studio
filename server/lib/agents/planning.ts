import type { PlanningStage } from '#shared/app-builder-planning'
import { documentFence, planningFiles } from '#shared/app-builder-planning'

// The prompts of the App Builder's planning chat (ADR 0054): requirements,
// then a plan, worked out with the coding agent before the app exists. The
// agent runs read-only in a folder with Studio's app template, so it can
// read how apps are built, and returns each document whole in a fenced block
// that the page puts in its editor (shared/app-builder-planning.ts).

export interface PlanningTurn {
  stage: PlanningStage
  /** What the user wrote; empty when the page asks for the stage's first draft. */
  message: string
  name: string
  idea: string
  /** The documents as they are in the page's editors, with the user's own changes. */
  requirements: string
  plan: string
}

const role = [
  'You help a user plan a new BaSyx Studio app before it is built. The folder you are in holds Studio\'s app template; read its AGENTS.md and README.md to learn how such apps are built (Vue, Vuetify, the Studio app kit and SDK, the AAS data they read).',
  'Do not create, edit or delete files, and do not run commands: you only plan here. Another session builds the app from the documents you write.',
  'Studio sets the app\'s ID, package name and folder when it creates the app, from its name; the IDs in this folder may differ from the final ones. Do not write the app ID or package name into the documents: refer to "the app" or its name.',
  'Answer in the language the user writes in. Keep your reply short: what you changed or suggest, and at most three questions where the idea is unclear. Then give the whole document as it now stands, never only a part, in one fenced block that starts with a line of four backticks and the info string given below, and ends with a line of four backticks (so code blocks with three backticks may appear inside). Write nothing after the block.',
].join('\n\n')

const stages: Record<PlanningStage, { goal: string, first: string }> = {
  requirements: {
    goal: `The document is the app's requirements (it becomes ${planningFiles.requirements}), in Markdown: a one-paragraph summary, the users and what they want to do, the functional requirements as a numbered list (R1, R2, …) each testable, the AAS data the app reads or writes (submodels, semantic IDs where known), and what is out of scope. Requirements say what the app does, not how.`,
    first: 'Write the first draft of the requirements from the idea. Mark assumptions you made as such, and ask about what matters most.',
  },
  plan: {
    goal: `The document is the plan to build the app (it becomes ${planningFiles.plan}), in Markdown: the views or modules the app contributes and what each shows, the components and files to create, how it reads and writes AAS data through the Studio SDK, then the steps in order as a numbered list, each small enough for one turn and naming the requirements (R1, …) it covers, and how each is tested.`,
    first: 'Propose a plan that meets the requirements. Name the choices the user should make.',
  },
}

/** The prompt for one turn of the planning chat. */
export function planningPrompt (turn: PlanningTurn): string {
  const stage = stages[turn.stage]
  const parts = [
    role,
    `App name: ${turn.name.trim() || '(not named yet)'}`,
    `The user's idea:\n${turn.idea.trim() || '(none given)'}`,
    `${stage.goal} Put it in a block with the info string \`${documentFence(turn.stage)}\`.`,
  ]
  if (turn.requirements.trim()) {
    parts.push(`The requirements as they stand${turn.stage === 'requirements' ? ', with the user\'s own edits (keep them unless asked otherwise)' : ' (agreed; do not change them here)'}:\n\n${turn.requirements.trim()}`)
  }
  if (turn.stage === 'plan' && turn.plan.trim()) {
    parts.push(`The plan as it stands, with the user's own edits (keep them unless asked otherwise):\n\n${turn.plan.trim()}`)
  }
  parts.push(turn.message.trim() ? `The user writes:\n${turn.message.trim()}` : stage.first)
  return parts.join('\n\n')
}

/** The first prompt of a project that was planned: build it from its documents. */
export function buildFromPlanPrompt (idea: string): string {
  return [
    `Build this app as described in ${planningFiles.requirements}, following ${planningFiles.plan}.`,
    'The app ID and package name in studio-app.json and package.json are the right ones; where the documents name others, keep the files as they are.',
    'Work through the plan\'s steps in order. When a step turns out differently than planned, update the plan file and say why. Finish with pnpm typecheck, pnpm test and pnpm build.',
    idea.trim() ? `The user's original idea, for context:\n${idea.trim()}` : '',
  ].filter(Boolean).join('\n\n')
}
