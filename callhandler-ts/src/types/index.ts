export interface Session {
    transcript: string;
    streamSid: string | null;
  }
  
  export interface AudioDelta {
    event: 'media';
    streamSid: string | null;
    media: {
      payload: string;
    };
  }
  
  export interface OpenAIResponse {
    type: string;
    transcript?: string;
    response?: {
      output: Array<{
        content: Array<{
          transcript: string;
        }>;
      }>;
    };
    delta?: string;
  }
  
  export interface CustomerDetails {
    customerName: string;
    customerAvailability: string;
    specialNotes: string;
  }
  
  export interface ChatGPTResponse {
    choices: Array<{
      message: {
        content: string;
      };
    }>;
  }
  
  export interface TwilioMediaMessage {
    event: string;
    media?: {
      payload: string;
    };
    start?: {
      streamSid: string;
    };
  }