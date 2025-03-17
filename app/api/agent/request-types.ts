// types.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;


// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ResponseOptions {
    model: string;
    previous_response_id?: string;
    input: string | Json[];
    include?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools?: any[];
    metadata?: Json;
    temperature?: number;
    top_p?: number;
    parallel_tool_calls?: boolean;
    stream?: boolean;
    response_format?: Json;
    tool_choice?: Json;
    truncation?: string;
}

interface ComputerCall {
    type: 'computer_call';
    id: string;
    action: {
        type: string;
        x?: number;
        y?: number;
        text?: string;
        keys?: string[];
        scroll_x?: number;
        scroll_y?: number;
    };
}

interface FunctionCall {
    type: 'function_call';
    id: string;
    name: string;
    arguments: string;
}

interface OutputText {
    type: 'output_text';
    text: string;
}

interface Message {
    type: 'message';
    content: [OutputText];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Response {
    id: string;
    output: (ComputerCall | Message | FunctionCall | OutputText)[];
}