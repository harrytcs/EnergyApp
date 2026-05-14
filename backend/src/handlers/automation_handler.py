"""
Lambda handler for the automation engine.
Triggered every 5 minutes by EventBridge.
"""
import json
import logging
import os
import boto3
from automation.engine import run

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sns = boto3.client("sns")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")


def send_notification(event_type: str, message: str) -> None:
    if not SNS_TOPIC_ARN:
        return
    sns.publish(
        TopicArn=SNS_TOPIC_ARN,
        Subject=event_type,
        Message=json.dumps({"event": event_type, "message": message}),
        MessageAttributes={
            "event_type": {"DataType": "String", "StringValue": event_type}
        },
    )


def handler(event, context):
    try:
        result = run(notify_fn=send_notification)
        logger.info(f"Automation cycle complete: {result}")
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception as e:
        logger.error(f"Automation cycle failed: {e}", exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
