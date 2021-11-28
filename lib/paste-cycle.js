const { CompositeDisposable } = require('atom')

const PASTE = {
  OLDER: +1,
  NEWER: -1,
  LAST: 0,
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
    doNormalPasteWhenMultipleCursors: {
      order: 3,
      type: "boolean",
      default: true,
      description: "Do normal paste when multiple cursors"
    }
  },

  activate() {
    this.entries = []
    this.lastPastedText = null

    // paste cycle state
    this.cursorMoveObserver = null
    this.contentEditObserver = null
    this.markerByCursor = new Map()
    this.checkpoint = null
    this.index = -1
    this.pasting = false

    this.disposables = new CompositeDisposable()
    this.disposables.add(atom.workspace.onDidChangeActiveTextEditor(() => this.resetPasteState()))

    this.atomClipboardWrite = atom.clipboard.write
    atom.clipboard.write = (text, metadata) => this.copy(text, metadata)

    this.disposables.add(atom.commands.add("atom-text-editor", {
      "paste-cycle:paste": makeCommandCallback(editor => this.paste(editor, PASTE.OLDER)),
      "paste-cycle:paste-newer": makeCommandCallback(editor => this.paste(editor, PASTE.NEWER)),
      "paste-cycle:paste-last": makeCommandCallback(editor => this.paste(editor, PASTE.LAST)),
      "paste-cycle:clear": makeCommandCallback(editor => this.clear()),
    }))
  },

  deactivate() {
    atom.clipboard.write = this.atomClipboardWrite
    this.clear()
    this.disposables.dispose()
  },

  clear() {
    this.entries = []
    this.resetPasteState()
  },

  hasCursor(cursor) {
    return this.markerByCursor.has(cursor)
  },

  getCursorRange(cursor) {
    if (this.markerByCursor.get(cursor))
      return this.markerByCursor.get(cursor).getBufferRange()
  },

  setCursorRange(cursor, range) {
    if (this.markerByCursor.get(cursor))
      this.markerByCursor.get(cursor).destroy()
    const marker = cursor.editor.markBufferRange(range)
    this.markerByCursor.set(cursor, marker)
    return marker
  },

  isInPasteCycle() {
    return this.cursorMoveObserver !== null
  },

  enterPasteCycle(editor) {
    if (this.cursorMoveObserver)
      this.cursorMoveObserver.dispose()
    if (this.contentEditObserver)
      this.contentEditObserver.dispose()
    this.cursorMoveObserver = editor.onDidChangeSelectionRange(() => this.pasting ? null : this.resetPasteState())
    this.contentEditObserver = editor.onDidChange(() => this.pasting ? null : this.resetPasteState())
    this.checkpoint = editor.createCheckpoint()
  },

  resetPasteState() {
    this.markerByCursor.forEach(marker => marker.destroy())
    this.markerByCursor.clear()
    this.checkpoint = null
    this.index = -1
    if (this.cursorMoveObserver)
      this.cursorMoveObserver.dispose()
    if (this.contentEditObserver)
      this.contentEditObserver.dispose()
    this.cursorMoveObserver = null
    this.contentEditObserver = null
  },

  updatePasteState(which) {
    if (which === PASTE.LAST) {
      return this.lastPastedText
    } else {
      const length = this.entries.length
      if (!length)
        return null
      // make index rap within length
      const index = this.index + which
      this.index = (index % length + length) % length
      return this.entries[this.index]
    }
  },

  addTextToHistory(text, metadata) {
    // remove the same text
    const index = this.entries.findIndex(entry => entry.text == text)
    if (index !== -1)
      this.entries.splice(index, 1)
    this.entries.unshift({text, metadata})
    this.entries.splice(atom.config.get("paste-cycle.max"))
  },

  copy(text, metadata) {
    this.addTextToHistory(text, metadata)
    this.resetPasteState()
    this.atomClipboardWrite.call(atom.clipboard, text, metadata)
  },

  paste(editor, which) {
    if (editor.hasMultipleCursors() && atom.config.get("paste-cycle.doNormalPasteWhenMultipleCursors")) {
      editor.pasteText()
      return
    }

    // enter paste cycle
    if (!this.isInPasteCycle()) {
      // This is 1st paste, system's clipboad might updated in outer world.
      this.addTextToHistory(atom.clipboard.read())
      this.enterPasteCycle(editor)
    }

    const textToPaste = this.updatePasteState(which)
    if (!textToPaste) return

    // don't flash when paste-last
    const select = atom.config.get("paste-cycle.selectPasted")
    const autoIndent = atom.config.get("editor.autoIndentOnPaste")
    const flash = which !== PASTE.LAST && atom.config.get("paste-cycle.flashOnPaste")

    // paste text
    this.pasting = true

    for (const cursor of editor.getCursors())
      this.insertText(cursor, textToPaste.text, {select, autoIndent, flash})
    editor.scrollToCursorPosition({center: false})
    this.lastPastedText = textToPaste

    this.pasting = false
    editor.groupChangesSinceCheckpoint(this.checkpoint)

    // leave paste cycle immediately after paste-last
    if (which === PASTE.LAST)
      this.resetPasteState()
  },

  insertText(cursor, text, {select, autoIndent, flash}) {
    if (this.hasCursor(cursor))
      cursor.selection.setBufferRange(this.getCursorRange(cursor))
    const range = cursor.selection.insertText(text, {select, autoIndent})
    const marker = this.setCursorRange(cursor, range)

    if (flash) {
      const markerForFlash = marker.copy()
      cursor.editor.decorateMarker(markerForFlash, {type: "highlight", class: "paste-cycle-pasted"})
      setTimeout(() => markerForFlash.destroy(), 1000)
    }
  },
}
