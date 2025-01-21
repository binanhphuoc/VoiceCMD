from flask import Flask, request
from twilio.twiml.voice_response import VoiceResponse
from dotenv import load_dotenv
import openai
import os

# check https://youtu.be/AZ0WziqO_QA?si=9xAsLGsWGgp-FJD3

# Load environment variables
load_dotenv()

# Configure OpenAI
openai.api_key = os.getenv('OPENAI_API_KEY')

app = Flask(__name__)

def get_chatgpt_response(user_input, is_follow_up=False):
    """Get response from ChatGPT"""
    try:
        system_content = """You are a helpful customer service agent. 
                Keep responses clear and concise, under 50 words."""
        
        # Only add the END_CONVERSATION detection for follow-up responses
        if is_follow_up:
            system_content += """
                If the user says goodbye, thanks, or indicates they're done, include '[END_CONVERSATION]' at the end of your response.
                """

        response = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_input}
            ],
            max_tokens=100,
            temperature=0.7
        )
        response_text = response.choices[0].message.content.strip()
        
        # Check if response indicates conversation should end (only for follow-ups)
        should_end = is_follow_up and '[END_CONVERSATION]' in response_text
        # Remove the end marker from the actual response
        clean_response = response_text.replace('[END_CONVERSATION]', '').strip()
        
        return {
            'response': clean_response,
            'end_conversation': should_end
        }
    except Exception as e:
        print(f"Error with ChatGPT API: {e}")
        return {
            'response': "I apologize, but I'm having trouble processing your request. Please try again.",
            'end_conversation': False
        }

def format_speech(text):
    """Format text with SSML for more natural speech"""
    return f"""
    <speak>
        <prosody rate="95%" pitch="-2%">
            {text}
        </prosody>
    </speak>
    """

@app.route("/answer", methods=['POST'])
def answer_call():
    """Handle incoming phone calls"""
    resp = VoiceResponse()
    
    # Welcome message and gather speech input
    with resp.gather(input='speech', action='/handle-input', method='POST', timeout=3) as gather:
        gather.say(
            format_speech("Welcome! How can I help you today?"),
            voice='Google.en-US-Neural2-F'
        )
    
    return str(resp)

@app.route("/handle-input", methods=['POST'])
def handle_input():
    """Handle voice input and process with ChatGPT"""
    resp = VoiceResponse()
    
    # Get the spoken input
    speech_result = request.values.get('SpeechResult', '')

    # Check if this is a follow-up response
    is_follow_up = 'anything else' in request.values.get('PreviousResponse', '').lower()

    # Get response from ChatGPT
    if not speech_result:
        chat_response = get_chatgpt_response("The user was silent. Please respond naturally as if you're talking to someone who hasn't said anything.", is_follow_up)
    else:
        chat_response = get_chatgpt_response(speech_result, is_follow_up)
    
    # Respond to user
    resp.say(
        format_speech(chat_response['response']),
        voice='Google.en-US-Neural2-F'
    )
    
    # Continue conversation only if it shouldn't end
    if not chat_response['end_conversation']:
        resp.pause(length=1)  # Add a small pause for more natural conversation flow
        with resp.gather(input='speech', action='/handle-input', method='POST', timeout=3) as gather:
            gather.say(
                format_speech("Is there anything else I can help you with?"),
                voice='Google.en-US-Neural2-F'
            )
    else:
        resp.pause(length=1)  # Add a small pause before goodbye
        resp.say(
            format_speech("Thank you for calling. Goodbye!"),
            voice='Google.en-US-Neural2-F'
        )
    
    return str(resp)

# @app.route("/menu", methods=['POST'])
# def menu():
#     """Handle menu options"""
#     resp = VoiceResponse()
    
#     # Gather speech input
#     with resp.gather(input='speech', action='/handle-input', method='POST', timeout=3) as gather:
#         gather.say("Please tell me how I can help you today.")
            
#     return str(resp)

if __name__ == "__main__":
    app.run(debug=True, port=5000) 