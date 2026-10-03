locals {
  game_session_name = "family-party-game-session"
}

# Zip the esbuild output. Run `pnpm build` BEFORE `terraform plan`.
data "archive_file" "game_session" {
  type        = "zip"
  source_dir  = "${path.module}/../../services/game-session/dist"
  output_path = "${path.module}/.build/game-session.zip"
}

# --- Question 1: who can BECOME this role? Only the Lambda service. ---
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "game_session" {
  name               = local.game_session_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# --- Question 2: what can the role DO? Exactly what handler.ts does. ---
data "aws_iam_policy_document" "game_session" {
  statement {
    sid       = "Connections"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:DeleteItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.connections.arn, "${aws_dynamodb_table.connections.arn}/index/byRoom"]
  }

  statement {
    sid       = "Rooms"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.rooms.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.game_session.arn}:*"]
  }
  statement {
    sid       = "PushToClients"
    actions   = ["execute-api:ManageConnections"]
    resources = ["${aws_apigatewayv2_api.ws.execution_arn}/${aws_apigatewayv2_stage.dev.name}/POST/@connections/*"]
  }
  statement {
    sid       = "PacksList" # see which packs exist, only under packs/
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.packs.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["packs/*"]
    }
  }
  statement {
    sid       = "PacksRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.packs.arn}/packs/*"]
  }
}

resource "aws_iam_role_policy" "game_session" {
  name   = "game-session"
  role   = aws_iam_role.game_session.id
  policy = data.aws_iam_policy_document.game_session.json
}

# Created by Terraform (not by Lambda) so it has a retention period and gets destroyed with the stack.
resource "aws_cloudwatch_log_group" "game_session" {
  name              = "/aws/lambda/${local.game_session_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "game_session" {
  function_name    = local.game_session_name
  role             = aws_iam_role.game_session.arn
  runtime          = "nodejs22.x"    # matches target: "node22" in build.mjs
  handler          = "index.handler" # dist/index.mjs → export handler
  architectures    = ["arm64"]       # Graviton: ~20% cheaper; plain JS runs on either
  filename         = data.archive_file.game_session.output_path
  source_code_hash = data.archive_file.game_session.output_base64sha256
  memory_size      = 256
  timeout          = 10

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      NODE_OPTIONS      = "--enable-source-maps" # readable stack traces from the sourcemap
      ROOMS_TABLE       = aws_dynamodb_table.rooms.name
      PACKS_BUCKET      = aws_s3_bucket.packs.bucket
    }
  }

  depends_on = [aws_cloudwatch_log_group.game_session, aws_iam_role_policy.game_session]
}
