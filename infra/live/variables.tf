variable "alert_email" {
  description = "Where budget alerts are sent"
  type        = string
  sensitive   = true
}

variable "ws_messages_per_hour_alarm" {
  description = "Alert when WebSocket messages in an hour exceed this (the stage throttle caps it at 72,000)"
  type        = number
  default     = 30000 # ~15 games at once
}
