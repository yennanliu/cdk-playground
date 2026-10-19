"""Background tasks: a row in the table plus an EventBridge schedule that fires the worker."""

import json

from botocore.exceptions import ClientError


class Tasks:
    def __init__(self, store, scheduler, group, worker_arn, role_arn):
        self.store = store
        self.scheduler = scheduler
        self.group = group
        self.worker_arn = worker_arn
        self.role_arn = role_arn

    @staticmethod
    def schedule_name(user, task_id):
        return f"{user}-{task_id}"  # a Cognito sub is 36 chars; the limit is 64

    def add(self, user, prompt, every_minutes):
        every_minutes = int(every_minutes)
        if every_minutes < 1:
            raise ValueError("every_minutes must be at least 1")
        task_id = self.store.add_task(user, prompt, every_minutes)
        self.scheduler.create_schedule(
            Name=self.schedule_name(user, task_id),
            GroupName=self.group,
            ScheduleExpression=f"rate({every_minutes} minute{'s' if every_minutes > 1 else ''})",
            FlexibleTimeWindow={"Mode": "OFF"},
            Target={
                "Arn": self.worker_arn,
                "RoleArn": self.role_arn,
                "Input": json.dumps({"task": {"user": user, "id": task_id}}),
                # A retried agent run could repeat its actions; the next tick is the retry.
                "RetryPolicy": {"MaximumRetryAttempts": 0},
            },
        )
        self.store.audit(user, "task_added", {"id": task_id, "every_minutes": every_minutes})
        return task_id

    def delete(self, user, task_id):
        try:
            self.scheduler.delete_schedule(Name=self.schedule_name(user, task_id), GroupName=self.group)
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceNotFoundException":
                raise
        deleted = self.store.delete_task(user, task_id)
        if deleted:
            self.store.audit(user, "task_deleted", {"id": task_id})
        return deleted
