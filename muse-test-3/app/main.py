"""AgentCore Runtime entry point (`entryPoint: ["main.py"]`): serves /invocations and /ping on :8080."""

from muse.agent import create_app

if __name__ == "__main__":
    create_app().run()
