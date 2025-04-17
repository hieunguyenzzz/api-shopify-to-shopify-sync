import { OpenAI } from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class OpenAIService {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required in environment variables');
    }
    
    this.client = new OpenAI({
      apiKey: apiKey,
    });
  }

  /**
   * Rewrites content using OpenAI API
   * @param text The text to rewrite
   * @param prompt The prompt to guide the rewriting (optional)
   * @returns The rewritten text
   * 
   * Note: When passing JSON in the text parameter, the prompt should specify
   * to maintain the same JSON structure in the output.
   */
  async rewriteContent(text: string, prompt?: string): Promise<string> {
    try {
      // Default instruction includes note about preserving JSON structure
      const defaultInstruction = 'Rewrite the following text. If the text contains JSON, preserve the exact JSON structure and only modify text content.';
      const instruction = prompt || defaultInstruction;
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-4.1-mini', // Can be configured based on requirements
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Error rewriting content with OpenAI:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const openAIService = new OpenAIService(); 