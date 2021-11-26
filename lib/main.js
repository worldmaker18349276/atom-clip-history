const PASTE = {
  OLDER: +1,
  NEWER: -1,
  LAST: 0,
}

class History {
  constructor() {
    this.lastPastedText = null
    this.pasting = false
    this.markerByCursor = new Map()
    this.entries = []
    this.checkpoint = null
    this.index = -1
    this.resetPasteState()
  }

  resetPasteState() {
    this.markerByCursor.forEach(marker => marker.destroy())
    this.markerByCursor.clear()
    this.checkpoint = null
    this.index = -1
  }

  clear() {
    this.entries = []
    this.resetPasteState()
  }

  destroy() {
    this.resetPasteState()
    if (this.cursorMoveObserver) this.cursorMoveObserver.dispose()
  }

  hasCursor(cursor) {
    return this.markerByCursor.has(cursor)
  }

  getCursorRange(cursor) {
    if (this.markerByCursor.get(cursor))
      return this.markerByCursor.get(cursor).getBufferRange()
  }

  setCursorRange(cursor, range) {
    if (this.markerByCursor.get(cursor))
      this.markerByCursor.get(cursor).destroy()
    const marker = cursor.editor.markBufferRange(range)
    this.markerByCursor.set(cursor, marker)
    return marker
  }

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
  }

  add(text, metadata) {
    // remove the same text
    const index = this.entries.findIndex(entry => entry.text == text)
    if (index !== -1)
      this.entries.splice(index, 1)
    this.entries.unshift({text, metadata})
    this.entries.splice(atom.config.get("clip-history.max"))
    this.resetPasteState()
  }

  paste(editor, which) {
    if (editor.hasMultipleCursors() && atom.config.get("clip-history.doNormalPasteWhenMultipleCursors")) {
      editor.pasteText()
      return
    }

    if (this.markerByCursor.size === 0) {
      // This is 1st paste, system's clipboad might updated in outer world.
      this.add(atom.clipboard.read())
      this.checkpoint = editor.createCheckpoint()
    }

    const textToPaste = this.updatePasteState(which)
    if (!textToPaste) return

    // observe cursor move
    if (!this.cursorMoveObserver) {
      this.cursorMoveObserver = editor.onDidChangeCursorPosition(() => {
        if (this.pasting) return
        this.resetPasteState()
        this.cursorMoveObserver.dispose()
        this.cursorMoveObserver = null
      })
    }

    // paste text
    this.pasting = true

    for (const cursor of editor.getCursors())
      this.insertText(cursor, textToPaste.text)
    editor.scrollToCursorPosition({center: false})
    this.lastPastedText = textToPaste

    this.pasting = false
    editor.groupChangesSinceCheckpoint(this.checkpoint)
    if (which === PASTE.LAST)
      this.resetPasteState()
  }

  insertText(cursor, text) {
    const autoIndent = atom.config.get("editor.autoIndentOnPaste")
    if (this.hasCursor(cursor))
      cursor.selection.setBufferRange(this.getCursorRange(cursor))
    const range = cursor.selection.insertText(text, {autoIndent})
    const marker = this.setCursorRange(cursor, range)

    if (atom.config.get("clip-history.flashOnPaste")) {
      const markerForFlash = marker.copy()
      cursor.editor.decorateMarker(markerForFlash, {type: "highlight", class: "clip-history-pasted"})
      setTimeout(() => markerForFlash.destroy(), 1000)
    }
  }
}

module.exports = {
  activate() {
    this.history = new History()

    this.atomClipboardWrite = atom.clipboard.write
    atom.clipboard.write = (...args) => {
      this.history.add(...args)
      return this.atomClipboardWrite.call(atom.clipboard, ...args)
    }

    const paste = (editor, which) => this.history.paste(editor, which)

    // prettier-ignore
    this.disposable = atom.commands.add("atom-text-editor", {
      "clip-history:paste"() { paste(this.getModel(), PASTE.OLDER) },
      "clip-history:paste-newer"() { paste(this.getModel(), PASTE.NEWER) },
      "clip-history:paste-last"() { paste(this.getModel(), PASTE.LAST) },
      "clip-history:clear": () => this.history.clear(),
    })
  },

  deactivate() {
    atom.clipboard.write = this.atomClipboardWrite
    this.history.destroy()
    this.disposable.dispose()
  },
}
