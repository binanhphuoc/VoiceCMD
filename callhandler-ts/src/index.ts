import Fastify, { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import fetch from 'node-fetch';
import { 
  Session, 
  AudioDelta, 
  OpenAIResponse, 
  CustomerDetails,
  TwilioMediaMessage
} from './types';

// Retrieve the OpenAI API key from environment variables
const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY || '';

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

// Initialize Fastify
const fastify: FastifyInstance = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
// const SYSTEM_MESSAGE: strx``ing = 'You are an AI receptionist for a comedy club. Your job is to entertain customers and make them laugh. If the customer is silent for more than 5 seconds, ask them if they are still there.'
const SYSTEM_MESSAGE: string = 'You are an AI receptionist for Barts Automotive. Your job is to politely engage with the client and obtain their name, availability, and service/work required. Ask one question at a time. Do not ask for other contact information, and do not check availability, assume we are free. Ensure the conversation remains friendly and professional, and guide the user to provide these details naturally. If necessary, ask follow-up questions to gather the required information.';
const VOICE: string = 'alloy';
const PORT: number = Number(process.env.PORT) || 5050;
const WEBHOOK_URL: string = "<input your webhook URL here>";

// Session management
const sessions: Map<string, Session> = new Map();

// List of Event Types to log to the console
const LOG_EVENT_TYPES: string[] = [
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
    'response.text.done',
    'conversation.item.input_audio_transcription.completed'
];

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Route for Twilio to handle incoming and outgoing calls
fastify.all('/incoming-call', async (request, reply) => {
    console.log('Incoming call');

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>Hi, you have called Bart's Automative Centre. How can we help?</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');

        const sessionId: string = req.headers['x-twilio-call-sid'] as string || `session_${Date.now()}`;
        let session: Session = sessions.get(sessionId) || { transcript: '', streamSid: null };
        sessions.set(sessionId, session);

        const openAiWs: WebSocket = new (WebSocket as any)('wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        const sendSessionUpdate = (): void => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ["text", "audio"],
                    temperature: 0.6,
                    input_audio_transcription: {
                        "model": "whisper-1"
                    }
                }
            };

            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        // Rest of the WebSocket handling code remains similar, just add type annotations
        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            setTimeout(sendSessionUpdate, 250);
        });

        openAiWs.on('message', (data: WebSocket.Data) => {
            try {
                const response: OpenAIResponse = JSON.parse(data.toString());

                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`Received event: ${response.type}`, response);
                }

                // User message transcription handling
                if (response.type === 'conversation.item.input_audio_transcription.completed' && response.transcript) {
                    const userMessage: string = response.transcript.trim();
                    session.transcript += `User: ${userMessage}\n`;
                    console.log(`User (${sessionId}): ${userMessage}`);
                }

                // Agent message handling
                if (response.type === 'response.done' && response.response) {
                    const agentMessage: string = response.response.output[0]?.content?.find(content => content.transcript)?.transcript || 'Agent message not found';
                    session.transcript += `Agent: ${agentMessage}\n`;
                    console.log(`Agent (${sessionId}): ${agentMessage}`);
                    console.error((response.response as any)["status_details"]?.error)
                }

                if (response.type === 'session.updated') {
                    console.log('Session updated successfully:', response);
                }

                if (response.type === 'response.audio.delta' && response.delta) {
                    const audioDelta: AudioDelta = {
                        event: 'media',
                        streamSid: session.streamSid,
                        media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
                    };
                    connection.send(JSON.stringify(audioDelta));
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });

        // Handle incoming messages from Twilio
        connection.on('message', (message: WebSocket.Data) => {
            try {
                const data: TwilioMediaMessage = JSON.parse(message.toString());

                switch (data.event) {
                    case 'media':
                        if (openAiWs.readyState === WebSocket.OPEN && data.media) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };

                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        if (data.start) {
                            session.streamSid = data.start.streamSid;
                            console.log('Incoming stream has started', session.streamSid);
                        }
                        break;
                    default:
                        console.log('Received non-media event:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
        });

        // Handle connection close and log transcript
        connection.on('close', async () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log(`Client disconnected (${sessionId}).`);
            console.log('Full Transcript:');
            console.log(session.transcript);

            await processTranscriptAndSend(session.transcript, sessionId);

            // Clean up the session
            sessions.delete(sessionId);
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', (code, reason) => {
            console.log('Disconnected from the OpenAI Realtime API', code, reason);
        });

        openAiWs.on('error', (error: any) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});

// Function to make ChatGPT API completion call with structured outputs
async function makeChatGPTCompletion(transcript: string): Promise<any> {
    console.log('Starting ChatGPT API call...');
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-4o-2024-08-06",
                messages: [
                    { "role": "system", "content": "Extract customer details: name, availability, and any special notes from the transcript." },
                    { "role": "user", "content": transcript }
                ],
                response_format: {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "customer_details_extraction",
                        "schema": {
                            "type": "object",
                            "properties": {
                                "customerName": { "type": "string" },
                                "customerAvailability": { "type": "string" },
                                "specialNotes": { "type": "string" }
                            },
                            "required": ["customerName", "customerAvailability", "specialNotes"]
                        }
                    }
                }
            })
        });

        console.log('ChatGPT API response status:', response.status);
        const data = await response.json();
        console.log('Full ChatGPT API response:', JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error('Error making ChatGPT completion call:', error);
        throw error;
    }
}

// Function to send data to Make.com webhook
async function sendToWebhook(payload: CustomerDetails): Promise<void> {
    console.log('Sending data to webhook:', JSON.stringify(payload, null, 2));
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('Webhook response status:', response.status);
        if (response.ok) {
            console.log('Data successfully sent to webhook.');
        } else {
            console.error('Failed to send data to webhook:', response.statusText);
        }
    } catch (error) {
        console.error('Error sending data to webhook:', error);
    }
}

// Main function to extract and send customer details
async function processTranscriptAndSend(transcript: string, sessionId: string | null = null): Promise<void> {
    console.log(`Starting transcript processing for session ${sessionId}...`);
    try {
        // Make the ChatGPT completion call
        const result = await makeChatGPTCompletion(transcript);

        console.log('Raw result from ChatGPT:', JSON.stringify(result, null, 2));

        if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
            try {
                const parsedContent = JSON.parse(result.choices[0].message.content);
                console.log('Parsed content:', JSON.stringify(parsedContent, null, 2));

                if (parsedContent) {
                    // Send the parsed content directly to the webhook
                    await sendToWebhook(parsedContent);
                    console.log('Extracted and sent customer details:', parsedContent);
                } else {
                    console.error('Unexpected JSON structure in ChatGPT response');
                }
            } catch (parseError) {
                console.error('Error parsing JSON from ChatGPT response:', parseError);
            }
        } else {
            console.error('Unexpected response structure from ChatGPT API');
        }

    } catch (error) {
        console.error('Error in processTranscriptAndSend:', error);
    }
}

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
}); 