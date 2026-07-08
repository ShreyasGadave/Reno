import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";

const AIRequestSchema = z.object({
  action: z.enum(["autocomplete", "summarize", "rewrite", "chat"]),
  context: z.string(),
  prompt: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const result = AIRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, errors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { action, context, prompt } = result.data;
    const geminiKey = process.env.GEMINI_API_KEY;

    // --- Mock Fallback Mode if API key is not configured ---
    if (!geminiKey) {
      return handleMockAI(action, context, prompt);
    }

    // --- Live Gemini API Mode ---
    let systemInstruction = "";

    switch (action) {
      case "autocomplete":
        systemInstruction = "You are a professional writing assistant. Based on the following text context, autocomplete the next logical sentence or paragraph. Return ONLY the autocompleted text, with absolutely no preamble, quotes, markdown formatting, or commentary.";
        break;
      case "summarize":
        systemInstruction = "You are a helpful assistant. Summarize the following document content in a clear, concise bulleted list of key takeaways. Make sure the summary is professional, neat, and formatted in markdown.";
        break;
      case "rewrite":
        systemInstruction = `You are a copywriter. Rewrite the following text to match the requested tone instructions: '${prompt}'. Return ONLY the rewritten text, with no explanations, notes, or commentary.`;
        break;
      case "chat":
        systemInstruction = `You are an AI assistant helping a user write and understand their document. Based on the following document context: '${context}', answer the user's question: '${prompt}'. Be helpful, concise, and professional.`;
        break;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: `${systemInstruction}\n\nContext/Text to process:\n${context}` },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error details:", data);
      throw new Error(data?.error?.message || "Gemini API call failed");
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return NextResponse.json({
      success: true,
      text: text.trim(),
      mode: "live",
    });
  } catch (error: any) {
    console.error("AI Route error:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to process AI request" },
      { status: 500 }
    );
  }
}

// Fallback helper to provide a rich mock response when no key is set
function handleMockAI(action: string, context: string, prompt?: string) {
  let responseText = "";

  switch (action) {
    case "autocomplete":
      responseText = " and build scalable, secure solutions that guarantee high availability. Furthermore, the local-first architecture eliminates latency and ensures offline functionality remains smooth and uninterrupted.";
      break;
    case "summarize":
      responseText = `### Document Summary (Mock Mode)
- **Local-First Synchronization**: Uses browser IndexedDB cache to store offline updates and merges states dynamically when connection is recovered.
- **Three-Way Merge Algorithm**: Compares client edits and remote changes against a common base version to ensure conflict-free convergence.
- **Role-Based Security**: Restricts viewer access to prevent unauthorized write updates to the collaboration servers.
- *Note: Please add a valid \`GEMINI_API_KEY\` to your \`.env\` file to enable live AI intelligence!*`;
      break;
    case "rewrite":
      responseText = `[AI Rewrite (Mock Mode - Tone: ${prompt})]: Here is the rewritten text, formatted in a professional and engaging style to impress readers, summarizing the content: "${context.trim().substring(0, 100)}..."`;
      break;
    case "chat":
      responseText = `Hello! I am running in **Mock Mode** since there is no \`GEMINI_API_KEY\` configured in the \`.env\` file. 

However, inspecting the document context of length **${context.length} characters**, it starts with: 
*"${context.trim().substring(0, 80)}..."*

Your question was: **"${prompt}"**

To answer this with live AI analysis, please configure your Gemini API Key in the server configuration! Let me know if you want to write a mock response or outline how the synchronization architecture solves your problem.`;
      break;
  }

  return NextResponse.json({
    success: true,
    text: responseText,
    mode: "mock",
  });
}
