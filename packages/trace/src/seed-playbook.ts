// Example data: the playbook's eight versions as the replay demo shows them. v1 was written by
// hand, v2 and v4 changed wording only, the others came from a run's retro; v8 waits for approval.

import type { PlaybookSource, PlaybookStatus } from './contracts.js'

export interface SeedPlaybookVersion {
  version: number
  title: string
  source: PlaybookSource
  sourceRunId: number | null
  status: PlaybookStatus
  /** Days before the seed's "now" when it was written; v8 uses minutes (see seed.ts). */
  daysAgo: number
  content: string
}

const doc = (sections: {
  title: string
  po: string[]
  engineer: string[]
  reviewer: string[]
  qa: string[]
}) =>
  [
    sections.title,
    '',
    '## PO',
    ...sections.po.map((l) => `- ${l}`),
    '',
    '## Engineer',
    ...sections.engineer.map((l) => `- ${l}`),
    '',
    '## Reviewer',
    ...sections.reviewer.map((l) => `- ${l}`),
    '',
    '## QA',
    ...sections.qa.map((l) => `- ${l}`),
    '',
  ].join('\n')

const PLAN = 'Write the plan as numbered steps and the acceptance criteria as testable sentences.'
const FILES = 'List the files you expect to touch. The Engineer may touch others, but must say why.'
const READ = 'Read every file you change before you write it.'
const TESTS = 'Run the tests after each write.'
const TESTS_V7 = 'Run the tests after each write; never edit a test to make it pass.'
const READERS = 'Before changing a status field, find every reader of it and add a test for each reader.'
const BLOCK = 'Block on missing error handling.'
const BLOCK_V4 = 'Block on: missing error path, untested branch, a change outside the plan without a reason.'
const SUITE = 'Run the full suite, not only the new file.'
const NAME = 'Name the failing test and paste the expected and received values.'
const TITLE_V1 = '# Rules'
const TITLE_V2 = '# Playbook · the rules every role reads before it works'

export const SEED_PLAYBOOK: SeedPlaybookVersion[] = [
  {
    version: 1,
    title: 'Initial playbook',
    source: 'initial',
    sourceRunId: null,
    status: 'approved',
    daysAgo: 7,
    content: doc({ title: TITLE_V1, po: [PLAN], engineer: [TESTS], reviewer: [BLOCK], qa: [SUITE] }),
  },
  {
    version: 2,
    title: 'Wording only',
    source: 'manual',
    sourceRunId: null,
    status: 'approved',
    daysAgo: 6,
    content: doc({ title: TITLE_V2, po: [PLAN], engineer: [TESTS], reviewer: [BLOCK], qa: [SUITE] }),
  },
  {
    version: 3,
    title: 'Read before write',
    source: 'retro',
    sourceRunId: 112,
    status: 'approved',
    daysAgo: 5,
    content: doc({ title: TITLE_V2, po: [PLAN], engineer: [READ, TESTS], reviewer: [BLOCK], qa: [SUITE] }),
  },
  {
    version: 4,
    title: 'Wording only',
    source: 'manual',
    sourceRunId: null,
    status: 'approved',
    daysAgo: 4,
    content: doc({ title: TITLE_V2, po: [PLAN], engineer: [READ, TESTS], reviewer: [BLOCK_V4], qa: [SUITE] }),
  },
  {
    version: 5,
    title: 'PO lists the files to touch',
    source: 'retro',
    sourceRunId: 124,
    status: 'approved',
    daysAgo: 3,
    content: doc({
      title: TITLE_V2,
      po: [PLAN, FILES],
      engineer: [READ, TESTS],
      reviewer: [BLOCK_V4],
      qa: [SUITE],
    }),
  },
  {
    version: 6,
    title: 'QA names the failing test',
    source: 'retro',
    sourceRunId: 131,
    status: 'approved',
    daysAgo: 2,
    content: doc({
      title: TITLE_V2,
      po: [PLAN, FILES],
      engineer: [READ, TESTS],
      reviewer: [BLOCK_V4],
      qa: [SUITE, NAME],
    }),
  },
  {
    version: 7,
    title: 'Never edit a test to make it pass',
    source: 'retro',
    sourceRunId: 137,
    status: 'approved',
    daysAgo: 1,
    content: doc({
      title: TITLE_V2,
      po: [PLAN, FILES],
      engineer: [READ, TESTS_V7],
      reviewer: [BLOCK_V4],
      qa: [SUITE, NAME],
    }),
  },
  {
    version: 8,
    title: 'Before changing a status field, find every reader',
    source: 'retro',
    sourceRunId: 142,
    status: 'proposed',
    daysAgo: 0,
    content: doc({
      title: TITLE_V2,
      po: [PLAN, FILES],
      engineer: [READ, TESTS_V7, READERS],
      reviewer: [BLOCK_V4],
      qa: [SUITE, NAME],
    }),
  },
]
