import { WebClient } from "@slack/web-api";
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateObject } from "ai";
import { z } from "zod";
import { put, list } from "@vercel/blob";
import {
  ComputerCallOutput,
  ComputerToolCall,
  Item,
  Reasoning,
} from "../agent/types";
import { BrowserbaseBrowser } from "../agent/browserbase";
import { Agent } from "../agent/agent";

// Define state type
export interface AgentState {
  goal: string;
  currentStep: {
    output: Item[];
    responseId: string;
  };
}

interface OutputText {
  type: 'output_text';
  text: string;
}

interface Message {
  type: 'message';
  content: [OutputText];
}

// Helper functions for state management
export async function saveState(sessionId: string, state: AgentState) {
  const { url } = await put(
    `agent-${sessionId}-state.json`,
    JSON.stringify(state),
    { access: "public", addRandomSuffix: true }
  );
  return url;
}

export async function getState(sessionId: string): Promise<AgentState | null> {
  try {
    const { blobs } = await list({ prefix: `agent-${sessionId}-state` });
    if (blobs.length === 0) return null;

    // get the most recently created blob
    const mostRecentBlob = blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];

    const response = await fetch(mostRecentBlob.url);
    const text = await response.text();
    return JSON.parse(text) as AgentState;
  } catch (error) {
    console.error("[getState] Error retrieving state:", error);
    return null;
  }
}

async function selectStartingUrl(goal: string) {
  const message: CoreMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `Given the goal: "${goal}", determine the best URL to start from.
Choose from:
1. A relevant search engine (Google, Bing, etc.)
2. A direct URL if you're confident about the target website
3. Any other appropriate starting point

Return a URL that would be most effective for achieving this goal.`,
      },
    ],
  };

  // Initialize OpenAI client
  const LLMClient = openai("gpt-4o");

  const result = await generateObject({
    model: LLMClient,
    schema: z.object({
      url: z.string().url(),
      reasoning: z.string(),
    }),
    abortSignal: AbortSignal.timeout(5000),
    messages: [message],
  }).catch((error) => {
    console.error("OpenAI timeout when generating starting URL, falling back to Google");
    return {
      object: {
        url: "https://www.google.com",
      },
    };
  });

  return result.object;
}

async function execute(computer: BrowserbaseBrowser, agent: Agent, output: any) {
  await computer.connect();

  const result = await agent.takeAction(output.output);

  return result;
}

async function generate(computer: BrowserbaseBrowser, agent: Agent, input: any, responseId: string) {
  let result = await agent.getAction(input, responseId);

  // If there's a screenshot returned, just handle it right here so we don't have to make a round trip.
  if (result.output.find((item) => item.type === "computer_call")) {
    const computerCall = result.output.find(
      (item) => item.type === "computer_call"
    ) as ComputerToolCall;
    if (computerCall.action.type === "screenshot") {
      await computer.connect();

      const screenshotAction = await agent.takeAction(result.output);
      result = await agent.getAction(
        screenshotAction.filter((item) => item.type != "message"),
        result.responseId
      );
    }
  }

  // If the generated action is only reasoning, let's request a real action.
  if (
    result.output.length == 1 &&
    result.output.find((item) => item.type === "reasoning")
  ) {
    do {
      result = await agent.getAction([(result.output[0] as Reasoning)], result.responseId);
    } while (
      result.output.length == 1 &&
      result.output.find((item) => item.type === "reasoning")
    );
  }

  return result;
}

export async function runAgentLoop(
  computer: BrowserbaseBrowser,
  agent: Agent,
  goal: string,
  sessionId: string,
  slack?: WebClient,
  channel?: string,
  threadTs?: string,
  savedState?: AgentState,
  userResponse?: string
) {
  // Initialize state from saved state if it exists
  let currentStep: {
    output: Item[];
    responseId: string;
  } | null = null;

  if (savedState) {
    try {
      currentStep = savedState.currentStep;
    } catch (error) {
      console.error("[runAgentLoop] Error parsing saved state:", error);
    }
  }

  // If we have saved state, skip URL selection
  if (!savedState) {
    if (slack && channel && threadTs) {
      await slack.chat.postMessage({
        channel: channel,
        text: `🤖 Operator: Starting up to complete the task!\n\nYou can follow along at https://www.browserbase.com/sessions/${sessionId}`,
        thread_ts: threadTs,
      });
    } else {
      console.log(
        `🤖 Operator: Starting up to complete the task! You can follow along at https://www.browserbase.com/sessions/${sessionId}`
      );
    }
    await computer.connect();

    const startingUrl = await selectStartingUrl(goal);
  
    await computer.goto(startingUrl.url);
    // Initialize the agent with the first step
    currentStep = await agent.getAction([
      {
        role: "user",
        content: goal,
      },
    ], undefined);
  }

  if (userResponse && currentStep) {
    currentStep = await generate(
      computer,
      agent,
      [
        {
          role: "assistant",
          content: (currentStep.output.find((item) => item.type === "message") as Message | undefined)?.content[0].text ?? "",
        },
        {
          role: "user",
          content: userResponse,
        },
      ],
      currentStep.responseId ?? null
    );
  }

  while (currentStep) {
    const reasoning = currentStep.output.find(
      (item: any) => item.type === "reasoning"
    ) as Reasoning;
    if (reasoning) {
      if (slack && channel && threadTs) {
        await slack.chat.postMessage({
          channel: channel,
          text: `🧠 Reasoning: ${reasoning.summary[0].text}`,
          thread_ts: threadTs,
        });
      } else {
        console.log(`🧠 Reasoning: ${reasoning.summary[0].text}`);
      }
    }

    if (!slack) {
        const action = (currentStep.output.find((item: any) => item.type === "computer_call") as ComputerToolCall)?.action;
        console.log(`🖥️  Action: ${JSON.stringify(action)}`);
    }
    // Perform the last step
    const nextOutput = await execute(computer, agent, currentStep);

    if (
      reasoning &&
      nextOutput.find((item: any) => item.type === "computer_call_output")
    ) {
      const computerCall = nextOutput.find(
        (item: any) => item.type === "computer_call_output"
      ) as ComputerCallOutput;
      if (slack && channel && threadTs) {
        await slack.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          file: Buffer.from(
            computerCall.output.image_url.replace(
              /^data:image\/\w+;base64,/,
              ""
            ),
            "base64"
          ),
          filename: "screenshot.png",
        });
      }
    }

    // Get next step
    const nextStep = await generate(
      computer,
      agent,
      nextOutput,
      currentStep.responseId ?? null
    );

    currentStep = nextStep;

    const message = nextStep.output.find(
      (item: any) => item.type === "message"
    ) as Message | undefined;
    if (message) {
      if (slack && channel && threadTs) {
        await saveState(sessionId, {
          goal: goal,
          currentStep: nextStep,
        });
        const screenshot = await computer.screenshot();
        await slack.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          file: Buffer.from(screenshot.replace(
              /^data:image\/\w+;base64,/,
              ""
            ),
            "base64"
          ),
          filename: "screenshot.png",
        });
        await slack.chat.postMessage({
          channel: channel,
          text: `🤖 Operator: ${message.content[0].text}\n\n You can control the browser if needed at https://www.browserbase.com/sessions/${sessionId}`,
          thread_ts: threadTs,
        });
      } else {
        console.log(`🤖 Operator: ${message.content[0].text}`);
      }
      currentStep = null;
    }
  }
}
