function getConfig(param) {
  return atom.config.get(`clip-history.${param}`)
}

function adjustIndent(text, {editor, indent}) {
  const tabLength = editor.getTabLength()

  // Convert leading tab to space. support multiline string.
  text = text.replace(/^[\t ]+/gm, s => s.replace(/\t/g, " ".repeat(tabLength)))

  // Return shortest leading space string in multiline string.
  const shortest_indent = (text.match(/^(?!$) */gm) || [""]).sort((a, b) => a.length - b.length)[0]
  text = text.replace(new RegExp(`^${shortest_indent}`, "gm"), "")

  // add indent
  text = text.replace(/^(?!$)/gm, (m, offset) => (offset === 0 ? m : indent))

  if (editor.getSoftTabs())
    return text

  // Convert leading space to tab. support multiline string.
  return text.replace(/^ +/gm, s => "\t".repeat(Math.floor(s.length / tabLength)) + " ".repeat(s.length % tabLength))
}

class PasteArea {
  constructor() {
    this.markerByCursor = new Map()
  }

  has(cursor) {
    return this.markerByCursor.has(cursor)
  }

  getRange(cursor) {
    if (this.has(cursor))
      return this.markerByCursor.get(cursor).getBufferRange()
  }

  set(cursor, marker) {
    if (this.has(cursor))
      this.markerByCursor.get(cursor).destroy()
    this.markerByCursor.set(cursor, marker)
  }

  clear() {
    this.markerByCursor.forEach(marker => marker.destroy())
    this.markerByCursor.clear()
  }

  isEmpty() {
    return this.markerByCursor.size === 0
  }

  destroy() {
    this.clear()
  }
}

class History {
  constructor() {
    this.lastPastedText = null
    this.pasting = false
    this.pasteArea = new PasteArea()
    this.clear()
  }

  clear() {
    this.entries = []
    this.resetIndex()
  }

  resetPasteState() {
    this.pasteArea.clear()
    this.resetIndex()
  }

  resetIndex() {
    this.index = -1
  }

  destroy() {
    this.pasteArea.destroy()
    if (this.cursorMoveObserver) this.cursorMoveObserver.dispose()
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

    if (this.pasteArea.isEmpty()) {
      // This is 1st paste, system's clipboad might updated in outer world.
      this.add(atom.clipboard.read())
    }

    let textToPaste
    if (which === "lastPasted") {
      this.resetPasteState()
      textToPaste = this.lastPastedText
    } else {
      const index = this.index + (which === "newer" ? -1 : +1)
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
    const editor = cursor.editor
    const range = this.pasteArea.has(cursor) ? this.pasteArea.getRange(cursor) : cursor.selection.getBufferRange()
    if (getConfig("adjustIndent"))
      text = adjustIndent(text, {editor, indent: " ".repeat(range.start.column)})

    const marker = editor.markBufferRange(editor.setTextInBufferRange(range, text))
    this.pasteArea.set(cursor, marker)

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
      "clip-history:paste"() { paste(this.getModel(), "older") },
      "clip-history:paste-newer"() { paste(this.getModel(), "newer") },
      "clip-history:paste-last"() { paste(this.getModel(), "lastPasted") },
      "clip-history:clear": () => this.history.clear(),
    })
  },

  deactivate() {
    atom.clipboard.write = this.atomClipboardWrite
    this.history.destroy()
    this.disposable.dispose()
  },
}
