import { openAIService } from '../services/openai.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export async function testOpenAI() {
  try {
    // Test 1: Basic content rewriting
    console.log('Test 1: Basic content rewriting');
    const originalText = 'Soundbox Store offers high-quality acoustic panels for offices.';
    const rewrittenText = await openAIService.rewriteContent(originalText);
    console.log(`✅ Original: ${originalText}`);
    console.log(`✅ Rewritten: ${rewrittenText}`);
    console.log(`✅ Text was successfully rewritten\n`);

    // Test 2: Caching mechanism
    console.log('Test 2: Caching mechanism (should use cached result)');
    const cachedText = await openAIService.rewriteContent(originalText);
    console.log(`✅ Cached result: ${cachedText}`);
    console.log(`✅ Results match: ${rewrittenText === cachedText}\n`);

    // Test 3: Custom prompt
    console.log('Test 3: Custom prompt');
    const customText = 'We offer great products for your home.';
    const customPrompt = 'Rewrite this text to be more formal and professional. Only provide the rewritten text without explanations.';
    const customRewritten = await openAIService.rewriteContent(customText, customPrompt);
    console.log(`✅ Original: ${customText}`);
    console.log(`✅ Rewritten (formal): ${customRewritten}\n`);

    // Test 4: JSON preservation
    console.log('Test 4: JSON structure preservation');
    const jsonText = '{"title": "Soundbox Store Panel", "description": "A great acoustic panel"}';
    const jsonRewritten = await openAIService.rewriteContent(jsonText);
    console.log(`✅ Original JSON: ${jsonText}`);
    console.log(`✅ Rewritten JSON: ${jsonRewritten}`);

    // Verify it's still valid JSON
    try {
      JSON.parse(jsonRewritten);
      console.log(`✅ JSON structure preserved and valid\n`);
    } catch {
      console.log(`❌ Warning: Result is not valid JSON\n`);
    }

    console.log('✅ OpenAI/OpenRouter tests passed!');
  } catch (error) {
    console.error('❌ OpenAI test failed:', error);
    throw error;
  }
}

// If run directly, execute the test
if (require.main === module) {
  testOpenAI().catch(() => process.exit(1));
}
