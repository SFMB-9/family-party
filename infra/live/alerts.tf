# Fast alerts for public playtests.
# The budget emails (budget.tf) lag up to a day because billing data arrives late; CloudWatch
# metrics arrive within minutes. The stage throttle (api.tf) caps how bad it can get; these
# say when something is off, so the kill switch in the README gets used in hours, not days.

resource "aws_sns_topic" "alerts" {
  name = "family-party-alerts"
}

# AWS emails a confirmation link after the first apply: alerts only arrive once it's clicked.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Traffic far above what playtest groups generate (a 10-phone game is roughly 2,000 messages an hour).
resource "aws_cloudwatch_metric_alarm" "ws_traffic" {
  alarm_name          = "family-party-ws-traffic"
  alarm_description   = "WebSocket messages above ${var.ws_messages_per_hour_alarm}/hour: more traffic than playtests explain. Check the logs; the README has the kill switch."
  namespace           = "AWS/ApiGateway"
  metric_name         = "MessageCount"
  dimensions          = { ApiId = aws_apigatewayv2_api.ws.id, Stage = aws_apigatewayv2_stage.dev.name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.ws_messages_per_hour_alarm
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching" # no traffic is fine
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# The game crashing for someone you'll never hear from: errors usually mean a bug a new group found.
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "family-party-lambda-errors"
  alarm_description   = "game-session threw more than 10 errors in 5 minutes. CloudWatch Logs → /aws/lambda/family-party-game-session."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.game_session.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
