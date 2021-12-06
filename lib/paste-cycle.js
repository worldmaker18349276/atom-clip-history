const { CompositeDisposable } = require('atom')

const PASTE = {
  OLDER: +1,
  NEWER: -1,
}

class PasteCycleHistory {
  constructor() {
    this.entries = []
    this.index = null
    this.textToPaste = null
  }

  clearHistory() {
    this.entries = []
    this.index = null
  }

  updateIndex(which) {
    const length = this.entries.length
    if (length == 0)
      return

    // OLDER -> start from the newest; NEWER -> start from the oldest
    if (this.index === null)
      this.index = which === PASTE.OLDER ? -1 : length

    const index = this.index + which
    // make index rap within length
    this.index = (index % length + length) % length
    this.textToPaste = this.entries[this.index]
  }

  resetIndex() {
    this.index = null
    // don't reset `textToPaste`, this can be used for `paste-last`
  }

  compareCopyData(data1, data2) {
    if (data1.text != data2.text)
      return false
    if (data1.metadata.indentBasis != data2.metadata.indentBasis)
      return false
    if (data1.metadata.fullLine != data2.metadata.fullLine)
      return false
    if (!!data1.metadata.selections != !!data2.metadata.selections)
      return false
    if (data1.metadata.selections) {
      if (data1.metadata.selections.length != data2.metadata.selections.length)
        return false
      const length = data1.metadata.selections.length
      for (let i=0; i<length; i++) {
        const entry1 = data1.metadata.selections[i]
        const entry2 = data2.metadata.selections[i]
        if (entry1.text != entry2.text)
          return false
        if (entry1.indentBasis != entry2.indentBasis)
          return false
        if (entry1.fullLine != entry2.fullLine)
          return false
      }
    }
    return true
  }

  addTextToHistory(text, metadata) {
    if (!metadata)
      metadata = {}
    const data = {text, metadata}

    // only record the last data of multi-selections
    if (metadata.selections)
      this.entries.shift()

    // remove the same text
    const index = this.entries.findIndex(entry => this.compareCopyData(entry, data))
    if (index != -1)
      this.entries.splice(index, 1)

    this.entries.unshift(data)
    this.entries.splice(atom.config.get("paste-cycle.max"))

    this.resetIndex()
  }
}

function makeCommandCallback(func) {
  return function() {
    return func(this.getModel())
  }
}

module.exports = {
  config: {
    max: {
      order: 0,
      type: "integer",
      default: 10,
      minimum: 1,
      description: "Number of history to remember"
    },
    flashOnPaste: {
      order: 1,
      type: "boolean",
      default: true,
      description: "Flash when enter paste cycle"
    },
    selectPasted: {
      order: 2,
      type: "boolean",
      default: false,
      description: "Select pasted text"
    },
  },

  activate() {
    // paste cycle state
    this.pasteCycleObserver = null
    this.checkpoint = null
    this.pasting = false
    this.history = new PasteCycleHistory()

    // hack into clipboard
    this.clipboard = atom.clipboard
    this.atomClipboardWrite = this.clipboard.write
    this.atomClipboardReadWithMetadata = this.clipboard.readWithMetadata
    this.clipboard.write = (text, metadata) => this.write(text, metadata)
    this.clipboard.readWithMetadata = () => this.readWithMetadata()

    this.disposables = new CompositeDisposable()
    this.disposables.add(atom.commands.add("atom-text-editor", {
      "paste-cycle:paste": makeCommandCallback(editor => this.paste(editor, PASTE.OLDER)),
      "paste-cycle:paste-newer": makeCommandCallback(editor => this.paste(editor, PASTE.NEWER)),
      "paste-cycle:paste-last": makeCommandCallback(editor => this.pasteLast(editor)),
      "paste-cycle:copy-from-clipboard": makeCommandCallback(editor => this.copyFromClipboard()),
      "paste-cycle:clear": makeCommandCallback(editor => this.clear()),
    }))
  },

  deactivate() {
    this.clipboard.write = this.atomClipboardWrite
    this.clipboard.readWithMetadata = this.atomClipboardReadWithMetadata
    this.clear()
    this.disposables.dispose()
  },

  clear() {
    this.history.clearHistory()
    this.resetPasteCycle()
  },

  write(text, metadata) {
    this.atomClipboardWrite.call(this.clipboard, text, metadata)
    this.history.addTextToHistory(text, metadata)
    this.resetPasteCycle()
  },

  readWithMetadata() {
    // read clipboard if no text to paste
    if (this.pasting && this.history.textToPaste !== null)
      return this.history.textToPaste
    return this.atomClipboardReadWithMetadata.call(this.clipboard)
  },

  copyFromClipboard() {
    const data = this.atomClipboardReadWithMetadata.call(this.clipboard)
    this.history.addTextToHistory(data.text, data.metadata)
    this.resetPasteCycle()
  },

  isInPasteCycle() {
    return this.pasteCycleObserver !== null
  },

  enterPasteCycle(editor) {
    if (this.isInPasteCycle())
      this.resetPasteCycle()
    this.pasteCycleObserver = new CompositeDisposable()
    this.pasteCycleObserver.add(editor.onDidChangeSelectionRange(() => this.pasting ? null : this.resetPasteCycle()))
    this.pasteCycleObserver.add(editor.getBuffer().onWillChange(() => this.pasting ? null : this.resetPasteCycle()))
    this.pasteCycleObserver.add(atom.workspace.onDidChangeActivePaneItem(() => this.resetPasteCycle()))
    if (atom.config.get("paste-cycle.flashOnPaste"))
        this.pasteCycleObserver.add(editor.onDidInsertText(event => this.pasting ? this.flash(editor, event.range) : null))
    this.checkpoint = editor.createCheckpoint()
  },

  resetPasteCycle() {
    this.history.resetIndex()
    this.checkpoint = null
    if (this.pasteCycleObserver)
      this.pasteCycleObserver.dispose()
    this.pasteCycleObserver = null
  },

  paste(editor, which) {
    // enter paste cycle
    if (!this.isInPasteCycle()) {
      // This is 1st paste, system's clipboard might updated in outer world.
      this.copyFromClipboard()
      this.enterPasteCycle(editor)
    }

    this.history.updateIndex(which)

    const select = atom.config.get("paste-cycle.selectPasted")
    const autoIndent = atom.config.get("editor.autoIndentOnPaste")

    this.pasting = true

    editor.revertToCheckpoint(this.checkpoint)
    this.checkpoint = editor.createCheckpoint()

    editor.pasteText({select, autoIndent})
    editor.scrollToCursorPosition({center: false})

    this.pasting = false
  },

  pasteLast(editor) {
    if (this.isInPasteCycle())
      this.resetPasteCycle()

    const select = atom.config.get("paste-cycle.selectPasted")
    const autoIndent = atom.config.get("editor.autoIndentOnPaste")

    this.pasting = true

    editor.pasteText({select, autoIndent})
    editor.scrollToCursorPosition({center: false})

    this.pasting = false
  },

  flash(editor, range) {
    const marker = editor.markBufferRange(range)
    editor.decorateMarker(marker, {type: "highlight", class: "paste-cycle-pasted"})
    setTimeout(() => marker.destroy(), 1000)
  },
}
