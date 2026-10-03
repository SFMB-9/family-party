/** Server error codes → what a person reads. Unknown codes fall back to a generic message. */
const MESSAGES: Record<string, string> = {
  NOT_YOUR_TURN: "No es tu turno.",
  WRONG_PHASE: "Eso no se puede hacer ahora.",
  CARD_ALREADY_PLAYED: "Esa carta ya se jugó.",
  INVALID_ANSWER: "Respuesta no válida.",
  TOO_LATE: "Se acabó el tiempo.",
  NOT_ENOUGH_PLAYERS: "Se necesita al menos un jugador.",
  NOT_ENOUGH_QUESTIONS: "No hay suficientes preguntas para tantos jugadores con estas categorías.",
  NOT_ENOUGH_QUESTIONS_FOR_SELECTION: "No hay preguntas con esa selección.",
  ALREADY_JOINED: "Ya estás en la partida.",
  ROOM_FULL: "La sala está llena.",
  INVALID_NAME: "Escribe un nombre de 1 a 20 caracteres.",
  NAME_TAKEN: "Ese nombre ya lo tiene alguien.",
  NOT_HOST: "Solo el anfitrión puede hacer eso.",
  NOT_A_PLAYER: "Únete a la partida para jugar.",
  BAD_TOKEN: "Tu sesión anterior ya no es válida. Únete de nuevo.",
  BUSY: "Mucho movimiento, intenta otra vez.",
};

export const describeError = (code: string | null) => (code ? MESSAGES[code] ?? "Algo salió mal." : null);
