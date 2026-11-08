import { useCallback, useEffect, useRef, useState } from "react"

/*
 * Browser dictation for the finding description — the legacy SPA's
 * "🎤 Dictate" button, which used the Web Speech API where the browser
 * offers it (Chrome, Edge, Safari on iOS 14.5+) and told the user to type
 * otherwise. The transcript is appended to whatever is already in the
 * field so a finding can be dictated in several short bursts on site.
 *
 * This is the no-AI path; Block 10B (voice-to-finding) adds structuring
 * on top of the same transcript later.
 */

interface SpeechRecognitionResultLike {
  0: { transcript: string }
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access was blocked. Allow the microphone for this site to dictate.",
  "service-not-allowed":
    "Dictation is not allowed by this browser's settings. Type instead.",
  "no-speech": "No speech was heard. Tap Dictate and try again.",
  "audio-capture": "No microphone was found on this device.",
  network: "Dictation needs a connection to the speech service. Type instead.",
  aborted: "",
}

interface UseDictationOptions {
  /** Receives each final transcript chunk, already trimmed. */
  onTranscript: (text: string) => void
  lang?: string
}

export function useDictation({
  onTranscript,
  lang = "en-US",
}: UseDictationOptions) {
  const Recognition = getSpeechRecognition()
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  useEffect(
    () => () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    },
    [],
  )

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!Recognition || recognitionRef.current) return
    const recognition = new Recognition()
    recognition.lang = lang
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false
    recognition.onstart = () => {
      setError(null)
      setListening(true)
    }
    recognition.onresult = (event) => {
      const chunks: string[] = []
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript?.trim()
        if (transcript) chunks.push(transcript)
      }
      if (chunks.length) onTranscriptRef.current(chunks.join(" "))
    }
    recognition.onerror = (event) => {
      const message = ERROR_MESSAGES[event.error]
      setError(
        message === undefined ? `Dictation failed (${event.error}).` : message,
      )
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (err) {
      recognitionRef.current = null
      setError(err instanceof Error ? err.message : "Dictation failed.")
    }
  }, [Recognition, lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return {
    /** `false` when the browser has no speech recognition — hide the button. */
    supported: Recognition !== undefined,
    listening,
    error: error || null,
    start,
    stop,
    toggle,
  }
}
