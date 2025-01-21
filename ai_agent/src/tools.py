from openai.types.chat import ChatCompletionToolParam
from pipecat.services.openai import OpenAILLMService

tools = [
    ChatCompletionToolParam(
        type="function",
        function={
            "name": "hang_up",
            "description": "Hang up the call when user no longer has any other questions",
        },
    ),
    ChatCompletionToolParam(
        type="function",
        function={
            "name": "register_for_event",
            "description": "Register user for an event. Before registering, make sure that event still has available slots.",
            "parameters": {
                "type": "object",
                "properties": {
                    "full_name": {
                        "type": "string",
                        "description": "The full name of the user",
                    },
                    "phone_number": {
                        "type": "string",
                        "description": "The phone number of the user",
                    },
                },
                "required": ["full_name", "phone_number"],
            },
        },
    ),
    ChatCompletionToolParam(
        type="function",
        function={
            "name": "check_event_availability",
            "description": "Check if the event still has open slots before user registration.",
            "result": {
                "type": "object",
                "properties": {
                    "open_slot_count": {
                        "type": "number",
                        "description": "The number of open slots available for registering.",
                    },
                },
            },
        },
    ),
]


def register_tools(llm: OpenAILLMService):
    open_slot = 0

    async def register_for_event(
        function_name, tool_call_id, args, llm, context, result_callback
    ):
        if open_slot > 0:
            await result_callback({"status": "success"})
        else:
            await result_callback({"status": "failed", "reason": "event is full"})

    llm.register_function("register_for_event", register_for_event)

    async def check_event_availability(
        function_name, tool_call_id, args, llm, context, result_callback
    ):
        await result_callback({"open_slot_count": open_slot})

    llm.register_function("check_event_availability", check_event_availability)


def register_function(llm: OpenAILLMService, name: str, action):
    # Register the function
    llm.register_function(name, action)
