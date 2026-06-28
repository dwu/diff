import './style.css'
import { createTwoFilesPatch } from 'diff'

type UploadedFile = {
  id: string
  name: string
  content: string
}

type DiffPart = {
  value: string
  added?: boolean
  removed?: boolean
  chunkHeader?: boolean
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App container not found')
}

app.innerHTML = `
  <main class="layout">
    <header class="toolbar">
      <div>
        <h1>JsDiff UI</h1>
        <p class="subtitle">Based on <a href="https://github.com/kpdecker/jsdiff">https://github.com/kpdecker/jsdiff</a></p>
      </div>
    </header>

    <section class="upload-panel">
      <label class="dropzone" id="dropzone">
        <input id="file-input" type="file" multiple>
        <span class="dropzone-title">Drop files here or choose files</span>
        <span class="dropzone-text">Files are processed only in your browser.</span>
      </label>
      <div class="upload-actions">
        <button id="pick-files" type="button">Upload files</button>
        <button id="clear-files" type="button" class="secondary">Clear</button>
      </div>
    </section>

    <section class="workspace">
      <section class="file-panel">
        <label class="picker-label" for="left-file">File A</label>
        <select id="left-file" class="file-list" size="5"></select>
        <textarea id="left-text" spellcheck="false" placeholder="Choose a file to view or edit its contents"></textarea>
      </section>

      <div class="splitter" data-splitter="left" role="separator" aria-orientation="vertical" aria-label="Resize left and right panels" tabindex="0"></div>

      <section class="file-panel">
        <label class="picker-label" for="right-file">File B</label>
        <select id="right-file" class="file-list" size="5"></select>
        <textarea id="right-text" spellcheck="false" placeholder="Choose a file to view or edit its contents"></textarea>
      </section>

      <div class="splitter" data-splitter="right" role="separator" aria-orientation="vertical" aria-label="Resize right and diff panels" tabindex="0"></div>

      <section class="diff-panel">
        <div class="diff-header">
          <h2>Diff</h2>
          <span id="status" class="status">Upload at least two files.</span>
        </div>
        <div class="diff-output"><pre id="result"></pre></div>
      </section>
    </section>
  </main>
`

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const pickFilesButton = document.querySelector<HTMLButtonElement>('#pick-files')!
const clearFilesButton = document.querySelector<HTMLButtonElement>('#clear-files')!
const dropzone = document.querySelector<HTMLLabelElement>('#dropzone')!
const leftSelect = document.querySelector<HTMLSelectElement>('#left-file')!
const rightSelect = document.querySelector<HTMLSelectElement>('#right-file')!
const leftText = document.querySelector<HTMLTextAreaElement>('#left-text')!
const rightText = document.querySelector<HTMLTextAreaElement>('#right-text')!
const result = document.querySelector<HTMLPreElement>('#result')!
const status = document.querySelector<HTMLSpanElement>('#status')!
const workspace = document.querySelector<HTMLElement>('.workspace')!
const splitters = document.querySelectorAll<HTMLElement>('.splitter')

let files: UploadedFile[] = []
let leftFileId = ''
let rightFileId = ''
let leftContent = ''
let rightContent = ''

const MIN_PANEL_PERCENT = 15
const SPLITTER_WIDTH_PX = 10

function setWorkspaceColumns(left: number, middle: number, right: number) {
  workspace.style.setProperty('--left-pane', `${left}%`)
  workspace.style.setProperty('--middle-pane', `${middle}%`)
  workspace.style.setProperty('--right-pane', `${right}%`)
}

function getWorkspaceColumns() {
  const left = Number.parseFloat(workspace.style.getPropertyValue('--left-pane')) || 33.33
  const middle = Number.parseFloat(workspace.style.getPropertyValue('--middle-pane')) || 33.33
  const right = Number.parseFloat(workspace.style.getPropertyValue('--right-pane')) || 33.34

  return { left, middle, right }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function bindSplitter(splitter: HTMLElement) {
  splitter.addEventListener('pointerdown', (event) => {
    if (window.innerWidth <= 1100) {
      return
    }

    event.preventDefault()

    const splitterType = splitter.dataset.splitter
    const startX = event.clientX
    const start = getWorkspaceColumns()
    const workspaceWidth = workspace.getBoundingClientRect().width - SPLITTER_WIDTH_PX * 2

    if (workspaceWidth <= 0 || !splitterType) {
      return
    }

    splitter.dataset.dragging = 'true'
    document.body.dataset.resizing = 'true'
    splitter.setPointerCapture(event.pointerId)

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaPercent = ((moveEvent.clientX - startX) / workspaceWidth) * 100

      if (splitterType === 'left') {
        const combined = start.left + start.middle
        const nextLeft = clamp(start.left + deltaPercent, MIN_PANEL_PERCENT, combined - MIN_PANEL_PERCENT)
        const nextMiddle = combined - nextLeft
        setWorkspaceColumns(nextLeft, nextMiddle, start.right)
        return
      }

      const combined = start.middle + start.right
      const nextMiddle = clamp(start.middle + deltaPercent, MIN_PANEL_PERCENT, combined - MIN_PANEL_PERCENT)
      const nextRight = combined - nextMiddle
      setWorkspaceColumns(start.left, nextMiddle, nextRight)
    }

    const stopDragging = () => {
      delete splitter.dataset.dragging
      delete document.body.dataset.resizing
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function getSelectedFile(fileId: string) {
  return files.find((file) => file.id === fileId) ?? null
}

function renderSelectors() {
  const options = files
    .map((file) => `<option value="${file.id}">${escapeHtml(file.name)}</option>`)
    .join('')

  leftSelect.innerHTML = options
  rightSelect.innerHTML = options

  leftSelect.value = leftFileId
  rightSelect.value = rightFileId
}

function syncPaneContents() {
  leftContent = getSelectedFile(leftFileId)?.content ?? ''
  rightContent = getSelectedFile(rightFileId)?.content ?? ''
  leftText.value = leftContent
  rightText.value = rightContent
}

function normalizePatchDiff(leftName: string, rightName: string, leftValue: string, rightValue: string): DiffPart[] {
  let pastHunkHeader = false

  return createTwoFilesPatch(leftName, rightName, leftValue, rightValue)
    .split('\n')
    .map((entry) => {
      const change: DiffPart = {
        value: `${entry}\n`,
      }

      if (entry.startsWith('@@')) {
        change.chunkHeader = true
        pastHunkHeader = true
      } else if (pastHunkHeader) {
        if (entry.startsWith('-')) {
          change.removed = true
        } else if (entry.startsWith('+')) {
          change.added = true
        }
      }

      return change
    })
}

function renderDiff() {
  let left = getSelectedFile(leftFileId) || { id: 'a', name: 'a', content: '' }
  let right = getSelectedFile(rightFileId) || { id: 'b', name: 'b', content: '' }

  if (!leftContent || !rightContent) {
    result.innerHTML = ''
    status.textContent = 'Need two files to compare.'
    return
  }

  const parts = normalizePatchDiff(left.name, right.name, leftContent, rightContent)
  const normalized = [...parts]

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]
    const next = normalized[index + 1]

    if (current?.added && next?.removed) {
      normalized[index] = next
      normalized[index + 1] = current
      index += 1
    }
  }

  result.innerHTML = normalized
    .map((part) => {
      const value = escapeHtml(part.value)

      if (part.removed) {
        return `<del>${value}</del>`
      }

      if (part.added) {
        return `<ins>${value}</ins>`
      }

      if (part.chunkHeader) {
        return `<span class="chunk-header">${value}</span>`
      }

      return value
    })
    .join('')

  status.textContent = `${left.name} vs ${right.name}`
}

function syncSelections() {
  if (!leftFileId && files[0]) {
    leftFileId = files[0].id
  }

  if (!rightFileId && files[1]) {
    rightFileId = files[1].id
  }

  if (leftFileId && !getSelectedFile(leftFileId)) {
    leftFileId = files[0]?.id ?? ''
  }

  if (rightFileId && !getSelectedFile(rightFileId)) {
    rightFileId = files[1]?.id ?? files[0]?.id ?? ''
  }
}

async function readFile(file: File) {
  const content = await file.text()
  return {
    id: crypto.randomUUID(),
    name: file.name,
    content,
  } satisfies UploadedFile
}

async function addFiles(fileList: FileList | File[]) {
  const nextFiles = Array.from(fileList)

  if (nextFiles.length === 0) {
    return
  }

  const uploaded = await Promise.all(nextFiles.map(readFile))
  files = [...files, ...uploaded]
  syncSelections()
  renderSelectors()
  syncPaneContents()
  renderDiff()
}

function clearFiles() {
  files = []
  leftFileId = ''
  rightFileId = ''
  leftContent = ''
  rightContent = ''
  fileInput.value = ''
  renderSelectors()
  syncPaneContents()
  renderDiff()
}

fileInput.addEventListener('change', async () => {
  if (fileInput.files) {
    await addFiles(fileInput.files)
  }
})

pickFilesButton.addEventListener('click', () => {
  fileInput.click()
})

clearFilesButton.addEventListener('click', () => {
  clearFiles()
})

leftSelect.addEventListener('change', () => {
  leftFileId = leftSelect.value
  leftContent = getSelectedFile(leftFileId)?.content ?? ''
  leftText.value = leftContent
  renderDiff()
})

rightSelect.addEventListener('change', () => {
  rightFileId = rightSelect.value
  rightContent = getSelectedFile(rightFileId)?.content ?? ''
  rightText.value = rightContent
  renderDiff()
})

leftText.addEventListener('input', () => {
  leftContent = leftText.value
  renderDiff()
})

rightText.addEventListener('input', () => {
  rightContent = rightText.value
  renderDiff()
})

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropzone.dataset.dragging = 'true'
})

dropzone.addEventListener('dragleave', (event) => {
  const relatedTarget = event.relatedTarget
  if (!(relatedTarget instanceof Node) || !dropzone.contains(relatedTarget)) {
    delete dropzone.dataset.dragging
  }
})

dropzone.addEventListener('drop', async (event) => {
  event.preventDefault()
  delete dropzone.dataset.dragging

  if (event.dataTransfer?.files) {
    await addFiles(event.dataTransfer.files)
  }
})

setWorkspaceColumns(33.33, 33.33, 33.34)

for (const splitter of splitters) {
  bindSplitter(splitter)
}

renderSelectors()
syncPaneContents()
renderDiff()
