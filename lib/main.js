function getConfig(param) {
  return atom.config.get(`clip-history.${param}`)
}

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
    this.clear()
  }

  clear() {
    this.entries = []
    this.resetIndex()
  }

  resetIndex() {
    this.index = -1
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

  setCursorMarker(cursor, marker) {
    if (this.markerByCursor.get(cursor))
      this.markerByCursor.get(cursor).destroy()
    this.markerByCursor.set(cursor, marker)
  }

  resetPasteState() {
    this.markerByCursor.forEach(marker => marker.destroy())
    this.markerByCursor.clear()
    this.resetIndex()
  }

  add(text, metadata) {
    // skip when empty or same text
    if (!text.length || text === this.entries[0])
      return
    this.entries.unshift({text, metadata})

    // Unique by entry.text
    const entries = []
    const seen = {}
    for (let entry of this.entries) {
      if (entry.text in seen) continue
      entries.push(entry)
      seen[entry.text] = true
    }
    this.entries = entries
    this.entries.splice(getConfig("max"))
    this.resetIndex()
  }

  // To make index rap within length
  getIndex(index) {
    const length = this.entries.length
    if (!length) return -1
    index = index % length
    return index >= 0 ? index : length + index
  }

  paste(editor, which) {
    if (editor.hasMultipleCursors() && getConfig("doNormalPasteWhenMultipleCursors")) {
      editor.pasteText()
      return
    }

    if (this.markerByCursor.size === 0) {
      // This is 1st paste, system's clipboad might updated in outer world.
      this.add(atom.clipboard.read())
    }

    let textToPaste
    if (which === PASTE.LAST) {
      this.resetPasteState()
      textToPaste = this.lastPastedText
    } else {
      const index = this.index + which
      this.index = this.getIndex(index)
      textToPaste = this.entries[this.index]
    }

    if (!textToPaste) return

    // observeCursorMove
    if (!this.cursorMoveObserver) {
      this.cursorMoveObserver = editor.onDidChangeCursorPosition(() => {
        if (this.pasting) return
        this.resetPasteState()
        this.cursorMoveObserver.dispose()
        this.cursorMoveObserver = null
      })
    }
    this.pasting = true

    for (const cursor of editor.getCursors())
      this.insertText(cursor, textToPaste.text)
    editor.scrollToCursorPosition({center: false})
    this.lastPastedText = textToPaste

    this.pasting = false
  }

  insertText(cursor, text) {
    const autoIndent = getConfig("adjustIndent")
    const editor = cursor.editor
    if (this.hasCursor(cursor))
        cursor.selection.setBufferRange(this.getCursorRange(cursor))
    const marker = editor.markBufferRange(cursor.selection.insertText(text, {autoIndent}))
    this.setCursorMarker(cursor, marker)

    if (getConfig("flashOnPaste")) {
      const markerForFlash = marker.copy()
      editor.decorateMarker(markerForFlash, {type: "highlight", class: "clip-history-pasted"})
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
