// Neutral starter content for a new Plainlane database.

export const CATEGORIES = {
  general: { label: 'General', color: '#475569' },
  idea: { label: 'Idea', color: '#0369a1' },
  admin: { label: 'Admin', color: '#6d28d9' },
  finance: { label: 'Finance', color: '#15803d' },
  waiting: { label: 'Waiting', color: '#a16207' },
  important: { label: 'Important', color: '#be123c' },
}

export const PHASES = {
  focus: { label: 'Focus', color: '#b91c1c' },
  next: { label: 'Next', color: '#1d4ed8' },
  later: { label: 'Later', color: '#475569' },
}

const createdAt = Date.now()

export const SEED_CARDS = [
  {
    id: 'seed-welcome',
    title: 'Welcome to Plainlane',
    category: 'general',
    phase: 'focus',
    status: 'todo',
    details:
      'Open this card to edit its details, add comments, attach a file, or save research links.\n\n- Drag cards between lanes\n- Use the arrow buttons on touch devices\n- Create more boards from the top bar',
    contact: '',
    comments: [],
    createdAt,
  },
  {
    id: 'seed-documents',
    title: 'Attach a document or saved email',
    category: 'admin',
    phase: 'next',
    status: 'todo',
    details:
      'Open this card and attach a PDF, image, Office document, text file, EML, or MSG file. Files are stored directly in SQLite and remain available from the card.',
    contact: '',
    comments: [],
    createdAt: createdAt + 1,
  },
  {
    id: 'seed-research',
    title: 'Try optional web research',
    category: 'idea',
    phase: 'next',
    status: 'progress',
    details:
      'Add OPENAI_API_KEY to your local .env file, restart the stack, and open this card. Research is available only while a card is In Progress. Results and source links stay attached to the card.',
    contact: '',
    comments: [],
    createdAt: createdAt + 2,
  },
  {
    id: 'seed-export',
    title: 'Create your first board backup',
    category: 'important',
    phase: 'later',
    status: 'done',
    details:
      'Use Export in the header to download the current board as JSON. The backup includes cards, comments, research, source links, and attached file contents.',
    contact: '',
    comments: [],
    createdAt: createdAt + 3,
  },
]
