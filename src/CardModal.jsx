import { useEffect, useId, useMemo, useState } from 'react'
import { CATEGORIES, PHASES } from './seed.js'
import { keepFocusInside } from './dialog.js'

function fmt(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const DOCUMENT_KINDS = {
  form: 'Form',
  email: 'Email',
  contract: 'Contract',
  proof: 'Proof / confirmation',
  other: 'Other file',
}

const DOCUMENT_STATUSES = {
  open: 'Open',
  in_progress: 'In progress',
  ready_to_sign: 'Ready to sign',
  sent: 'Sent',
  confirmed: 'Confirmed / accepted',
  archived: 'Done / archived',
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function TextWithLinks({ text }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, index) => (
    /^https?:\/\//.test(part)
      ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part}</a>
      : part
  ))
}

function DocumentItem({ document, onUpdate, onDelete }) {
  const [draft, setDraft] = useState({ kind: document.kind, status: document.status, note: document.note || '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft({ kind: document.kind, status: document.status, note: document.note || '' })
  }, [document.kind, document.status, document.note])

  async function save() {
    setSaving(true)
    setError('')
    try {
      await onUpdate(document.id, draft)
    } catch (saveError) {
      setError(saveError.message || 'The file could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="document-item">
      <div className="document-main">
        <div className="document-icon" aria-hidden="true">{document.kind === 'email' ? '✉' : 'PDF'}</div>
        <div className="document-identity">
          <a href={`/api/documents/${document.id}/file`} target="_blank" rel="noreferrer">{document.filename}</a>
          <span>{formatBytes(document.size)} · added {fmt(document.createdAt)}</span>
        </div>
        <button type="button" className="document-delete" onClick={() => onDelete(document.id)} aria-label={`Delete ${document.filename}`}>✕</button>
      </div>
      <div className="document-fields">
        <label>Type
          <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            {Object.entries(DOCUMENT_KINDS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label>Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            {Object.entries(DOCUMENT_STATUSES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="document-note-row">
        <input
          value={draft.note}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          placeholder="Note, for example recipient or missing signature"
          aria-label={`Note for ${document.filename}`}
          maxLength={1000}
        />
        <button type="button" className="btn tiny" onClick={save} disabled={saving}>{saving ? '…' : 'Save status'}</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </article>
  )
}

function AnnotatedText({ text, sources }) {
  const citations = (sources || [])
    .filter((source) => (
      source.isCitation
      && Number.isInteger(source.startIndex)
      && Number.isInteger(source.endIndex)
      && source.startIndex >= 0
      && source.endIndex > source.startIndex
      && source.endIndex <= text.length
    ))
    .sort((a, b) => a.startIndex - b.startIndex)

  if (!citations.length) return <div className="research-summary">{text}</div>

  const parts = []
  let cursor = 0
  citations.forEach((citation, index) => {
    if (citation.startIndex < cursor) return
    if (citation.startIndex > cursor) parts.push(text.slice(cursor, citation.startIndex))
    parts.push(
      <a
        className="inline-citation"
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        title={citation.title || citation.url}
        key={`${citation.url}-${citation.startIndex}-${index}`}
      >
        {text.slice(citation.startIndex, citation.endIndex)}
      </a>
    )
    cursor = citation.endIndex
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <div className="research-summary">{parts}</div>
}

function ResearchRun({ run, onDelete }) {
  const sourceList = useMemo(() => {
    const unique = new Map()
    for (const source of run.sources || []) {
      if (!unique.has(source.url)) unique.set(source.url, source)
    }
    return [...unique.values()]
  }, [run.sources])

  return (
    <article className="research-run">
      <div className="research-run-head">
        <div>
          <span className="ai-label">AI web research</span>
          <time>{fmt(run.createdAt)}</time>
        </div>
        <button type="button" onClick={() => onDelete(run.id)} aria-label="Delete this research result">✕</button>
      </div>
      <p className="research-question">{run.question}</p>
      <AnnotatedText text={run.summary} sources={run.sources} />
      {sourceList.length > 0 && (
        <div className="source-list">
          <strong>Sources</strong>
          {sourceList.map((source, index) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={source.url} aria-label={`Open source ${index + 1}: ${source.title || source.url}`}>
              <span>{index + 1}</span>
              <span>{source.title || source.url}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      )}
      <p className="research-model">Created with {run.model || 'OpenAI'} · verify important information before acting</p>
    </article>
  )
}

export default function CardModal({
  card,
  onClose,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
  aiStatus,
  onResearch,
  onDeleteResearch,
  onAddDocument,
  onUpdateDocument,
  onDeleteDocument,
}) {
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(card)
  const [comment, setComment] = useState('')
  const [researchQuestion, setResearchQuestion] = useState('')
  const [researching, setResearching] = useState(false)
  const [researchError, setResearchError] = useState('')
  const [documentDraft, setDocumentDraft] = useState({ file: null, kind: 'form', status: 'open', note: '' })
  const [documentInputKey, setDocumentInputKey] = useState(0)
  const [documentUploading, setDocumentUploading] = useState(false)
  const [documentError, setDocumentError] = useState('')
  const titleId = useId()
  const researchInputId = useId()
  const commentInputId = useId()

  useEffect(() => {
    setDraft(card)
    setEdit(false)
    setResearchQuestion('')
    setResearchError('')
    setDocumentDraft({ file: null, kind: 'form', status: 'open', note: '' })
    setDocumentError('')
  }, [card.id])

  useEffect(() => {
    const handler = (event) => { if (event.key === 'Escape' && !researching) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, researching])

  useEffect(() => {
    const previousFocus = document.activeElement
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [card.id])

  function save() {
    onUpdate({
      title: draft.title.trim() || 'Untitled task',
      category: draft.category,
      phase: draft.phase,
      details: draft.details,
      contact: draft.contact,
    })
    setEdit(false)
  }

  function submitComment(event) {
    event.preventDefault()
    const text = comment.trim()
    if (!text) return
    onAddComment(text)
    setComment('')
  }

  async function submitResearch(event) {
    event.preventDefault()
    setResearching(true)
    setResearchError('')
    try {
      await onResearch(researchQuestion.trim())
      setResearchQuestion('')
    } catch (error) {
      setResearchError(error.message || 'Research failed.')
    } finally {
      setResearching(false)
    }
  }

  function selectDocument(event) {
    const file = event.target.files?.[0] || null
    const extension = file?.name.split('.').pop()?.toLowerCase()
    setDocumentDraft((current) => ({
      ...current,
      file,
      kind: ['eml', 'msg'].includes(extension) ? 'email' : current.kind,
    }))
  }

  async function submitDocument(event) {
    event.preventDefault()
    if (!documentDraft.file) return
    if (documentDraft.file.size > 15 * 1024 * 1024) {
      setDocumentError('The file is larger than 15 MB.')
      return
    }
    setDocumentUploading(true)
    setDocumentError('')
    try {
      const dataBase64 = await fileToBase64(documentDraft.file)
      await onAddDocument({
        filename: documentDraft.file.name,
        dataBase64,
        kind: documentDraft.kind,
        status: documentDraft.status,
        note: documentDraft.note,
      })
      setDocumentDraft({ file: null, kind: 'form', status: 'open', note: '' })
      setDocumentInputKey((value) => value + 1)
    } catch (uploadError) {
      setDocumentError(uploadError.message || 'The file could not be saved.')
    } finally {
      setDocumentUploading(false)
    }
  }

  const cat = CATEGORIES[card.category] || { label: card.category, color: '#888' }
  const phase = PHASES[card.phase]
  const researchRuns = card.researchRuns || []
  const documents = card.documents || []

  return (
    <div className="overlay" onClick={() => { if (!researching) onClose() }}>
      <div
        className="modal card-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={researching}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keepFocusInside}
        style={{ '--cat': cat.color }}
      >
        <button type="button" className="modal-close" onClick={onClose} disabled={researching} aria-label="Close task" autoFocus>✕</button>

        {!edit ? (
          <>
            <div className="card-tags">
              <span className="tag cat">{cat.label}</span>
              {phase && <span className="tag phase" style={{ '--ph': phase.color }}>{phase.label}</span>}
            </div>
            <h2 className="modal-title" id={titleId}>{card.title}</h2>
            {card.contact && <p className="modal-contact">Contact: {card.contact}</p>}
            {card.details && (
              <div className="modal-details">
                {card.details.split('\n').map((line, index) => (
                  <p key={index} className={line.trim().startsWith('-') ? 'li' : ''}>
                    <TextWithLinks text={line.trim().startsWith('-') ? line.trim().slice(1).trim() : line} />
                  </p>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEdit(true)}>Edit</button>
              <button type="button" className="btn danger" onClick={() => { if (confirm('Delete this task?')) onDelete() }}>Delete</button>
            </div>
          </>
        ) : (
          <div className="editform">
            <h2 className="modal-title" id={titleId}>Edit task</h2>
            <label>Title
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <div className="row2">
              <label>Category
                <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                  {Object.entries(CATEGORIES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                </select>
              </label>
              <label>Phase
                <select value={draft.phase || ''} onChange={(event) => setDraft({ ...draft, phase: event.target.value })}>
                  <option value="">— none —</option>
                  {Object.entries(PHASES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                </select>
              </label>
            </div>
            <label>Contact
              <input value={draft.contact || ''} onChange={(event) => setDraft({ ...draft, contact: event.target.value })} placeholder="Name · phone · email" />
            </label>
            <label>Details / checklist (one line per item, use “-” for bullets)
              <textarea rows={8} value={draft.details || ''} onChange={(event) => setDraft({ ...draft, details: event.target.value })} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={save}>Save</button>
              <button type="button" className="btn ghost" onClick={() => { setDraft(card); setEdit(false) }}>Cancel</button>
            </div>
          </div>
        )}

        <hr className="sep" />

        <section className="documents">
          <div className="section-head">
            <div>
              <span className="eyebrow">Attached to this card</span>
              <h3>Forms, documents and emails <span className="count">{documents.length}</span></h3>
            </div>
          </div>

          <form className="document-upload" onSubmit={submitDocument}>
            <label className="document-file-field">
              <span>Choose a file</span>
              <input
                key={documentInputKey}
                type="file"
                accept=".pdf,.eml,.msg,.png,.jpg,.jpeg,.webp,.doc,.docx,.odt,.txt"
                onChange={selectDocument}
                disabled={documentUploading}
              />
            </label>
            <div className="document-upload-fields">
              <label>Type
                <select value={documentDraft.kind} onChange={(event) => setDocumentDraft({ ...documentDraft, kind: event.target.value })}>
                  {Object.entries(DOCUMENT_KINDS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <label>Status
                <select value={documentDraft.status} onChange={(event) => setDocumentDraft({ ...documentDraft, status: event.target.value })}>
                  {Object.entries(DOCUMENT_STATUSES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <input
              className="document-upload-note"
              value={documentDraft.note}
              onChange={(event) => setDocumentDraft({ ...documentDraft, note: event.target.value })}
              placeholder="Optional note about status or contents"
              aria-label="Attachment note"
              maxLength={1000}
            />
            <div className="document-upload-foot">
              <span>PDF, EML, MSG, images and Office files · 15 MB maximum</span>
              <button className="btn primary" type="submit" disabled={!documentDraft.file || documentUploading}>
                {documentUploading ? 'Saving …' : 'Attach file'}
              </button>
            </div>
            {documentError && <p className="form-error" role="alert">{documentError}</p>}
          </form>

          {documents.length > 0 && (
            <div className="document-list">
              {documents.map((document) => (
                <DocumentItem
                  document={document}
                  key={document.id}
                  onUpdate={onUpdateDocument}
                  onDelete={(id) => { if (confirm('Permanently delete this file?')) onDeleteDocument(id) }}
                />
              ))}
            </div>
          )}
        </section>

        <hr className="sep" />

        <section className="research">
          <div className="section-head">
            <div>
              <span className="eyebrow">Research assistant</span>
              <h3>Attach current information and links</h3>
            </div>
            <span className={`ai-status ${aiStatus.configured ? 'ready' : ''}`} role="status">
              {aiStatus.configured ? 'AI ready' : 'Not configured'}
            </span>
          </div>

          {card.status === 'progress' ? (
            <form className="research-form" onSubmit={submitResearch}>
              <label className="sr-only" htmlFor={researchInputId}>Research question</label>
              <textarea
                id={researchInputId}
                rows={3}
                placeholder="Optional: describe what should be researched"
                value={researchQuestion}
                onChange={(event) => setResearchQuestion(event.target.value)}
                disabled={researching || !aiStatus.configured}
                maxLength={1200}
              />
              <div className="research-form-foot">
                <p>
                  The task title, details, and this question are sent to OpenAI. Attachments and comments are not sent.
                </p>
                <button className="btn ai-primary" type="submit" disabled={researching || !aiStatus.configured}>
                  {researching ? 'Researching …' : 'Start web research'}
                </button>
              </div>
              {!aiStatus.configured && (
                <p className="setup-hint">Add OPENAI_API_KEY to <code>.env</code> and restart the stack.</p>
              )}
              {researchError && <p className="form-error" role="alert">{researchError}</p>}
            </form>
          ) : (
            <p className="research-hint">
              {card.status === 'todo'
                ? 'Move this card to “In Progress” to start research.'
                : 'Move this card back to “In Progress” to start another research run.'}
            </p>
          )}

          {researchRuns.length > 0 && (
            <div className="research-runs">
              {researchRuns.map((run) => (
                <ResearchRun
                  run={run}
                  key={run.id}
                  onDelete={(id) => { if (confirm('Delete this research run and its sources?')) onDeleteResearch(id) }}
                />
              ))}
            </div>
          )}
        </section>

        <hr className="sep" />

        <section className="comments">
          <h3>Comments and notes <span className="count">{card.comments.length}</span></h3>
          <div className="comment-list">
            {card.comments.length === 0 && <p className="muted">No comments yet. Keep updates, call notes, and open questions here.</p>}
            {card.comments.map((message) => (
              <div key={message.id} className="comment">
                <div className="comment-body">{message.text}</div>
                <div className="comment-meta">
                  <span>{fmt(message.ts)}</span>
                  <button type="button" onClick={() => onDeleteComment(message.id)} aria-label="Delete comment">✕</button>
                </div>
              </div>
            ))}
          </div>
          <form className="comment-form" onSubmit={submitComment}>
            <label className="sr-only" htmlFor={commentInputId}>Comment</label>
            <textarea
              id={commentInputId}
              rows={2}
              placeholder="Add a comment… (Ctrl/Cmd + Enter)"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitComment(event) }}
            />
            <button className="btn primary" type="submit">Send</button>
          </form>
        </section>
      </div>
    </div>
  )
}
