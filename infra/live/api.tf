resource "aws_apigatewayv2_api" "ws" {
  name                       = "family-party-ws"
  protocol_type              = "WEBSOCKET"
  # Messages like {"action":"pick"} would go to a route named "pick";
  # anything else goes to $default. We only use $default for now.
  route_selection_expression = "$request.body.action"
}

# How API Gateway calls the Lambda. AWS_PROXY = pass the whole event through untouched.
resource "aws_apigatewayv2_integration" "game_session" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.game_session.invoke_arn
}

# Three routes, one integration: the Lambda branches on routeKey itself.
resource "aws_apigatewayv2_route" "routes" {
  for_each  = toset(["$connect", "$disconnect", "$default"])
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.game_session.id}"
}

resource "aws_apigatewayv2_stage" "dev" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = "dev"
  auto_deploy = true   # every change to routes/integrations goes live without a manual "deploy"

  # A ceiling on traffic: protects your bill if someone hammers the endpoint.
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20   # messages per second, across all connections
  }
}

# Permission question 3: who may INVOKE the Lambda? This API, and nothing else.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowWebSocketApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.game_session.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*"
}

output "websocket_url" {
  value = aws_apigatewayv2_stage.dev.invoke_url
}
