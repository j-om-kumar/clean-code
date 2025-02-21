import * as vscode from 'vscode';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Global animation state
let animationState = {
    active: false,
    cancelRequested: false,
    finishRequested: false,
    originalCode: '',
    originalSelection: null as vscode.Selection | null
};

// Function to get selected code
function getSelectedCode(): { code: string, editor: vscode.TextEditor } | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return null;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);
    const lineCount = text.split('\n').length;

    if (lineCount > 100) {
        vscode.window.showErrorMessage('Selection exceeds 100 lines limit');
        return null;
    }

    return { code: text, editor };
}

// LLM interaction with openai
async function cleanCodeWithLLM(code: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('codeCleaner');
    const apiKey = config.get<string>('llmApiKey');

    if (!apiKey) {
        throw new Error('API key not configured');
    }

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'Clean and Enhance this code without changing logic, you make the best version by adding handling exceptions and other good features which make the code perform much better. Preserve formatting, indentation and line breaks.Make sure the output is only the code nothing extra.'
                },
                {
                    role: 'user',
                    content: code
                }
            ]
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data.choices[0].message.content;
}

//AIzaSyDJ-RnW7ipN1ujxk7-xKBj_V34R3UoUADc
// async function cleanCodeWithLLM(code: string): Promise<string> {
//     // Get configuration
//     const config = vscode.workspace.getConfiguration('codeCleaner');
//     const apiKey = config.get<string>('geminiApiKey');
    
//     if (!apiKey) {
//         throw new Error('Gemini API key not configured');
//     }

//     console.log('Initializing Gemini API...');
//     const genAI = new GoogleGenerativeAI(apiKey);
//     const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

//     const prompt = `Clean and Enhance this code without changing logic. Improve it by handling exceptions, optimizing performance, and making it more robust. Maintain formatting and comments.
// \`\`\`
// ${code}
// \`\`\`
// Respond ONLY with the cleaned code, no explanations.`;

//     console.log('Sending request to Gemini API...');
//     try {
//         const result = await model.generateContent(prompt);
//         const response = await result.response;
//         const text = response.text();
        
//         if (!text) {
//             throw new Error("Empty response from Gemini API");
//         }
        
//         return text;
//     } catch (error) {
//         console.error('Gemini API Error:', error);
//         throw new Error(`Gemini API Error: ${error instanceof Error ? error.message : String(error)}`);
//     }
// }

// Animation logic
async function animateCodeReplacement(editor: vscode.TextEditor, newCode: string, speed: number = 15) {
    animationState.active = true;
    animationState.cancelRequested = false;
    animationState.finishRequested = false;
    animationState.originalCode = editor.document.getText(editor.selection);
    animationState.originalSelection = editor.selection;

    try {
        // Delete original code
        await editor.edit(editBuilder => {
            editBuilder.delete(editor.selection);
        });

        const lines = newCode.split('\n');
        let currentPosition = editor.selection.start;

        for (const line of lines) {
            if (animationState.finishRequested) break;
            if (animationState.cancelRequested) throw new Error('Cancelled');

            // Type each character
            for (let i = 0; i < line.length; i++) {
                if (animationState.finishRequested) break;
                if (animationState.cancelRequested) throw new Error('Cancelled');

                await editor.edit(editBuilder => {
                    editBuilder.insert(currentPosition, line[i]);
                });

                currentPosition = currentPosition.with({
                    character: currentPosition.character + 1
                });

                await new Promise(resolve => setTimeout(resolve, speed));
            }

            // Add newline if not last line
            if (line !== lines[lines.length - 1] && !animationState.finishRequested) {
                await editor.edit(editBuilder => {
                    editBuilder.insert(currentPosition, '\n');
                });
                currentPosition = currentPosition.with({
                    line: currentPosition.line + 1,
                    character: 0
                });
            }
        }

        // If finished early, insert remaining code
        if (animationState.finishRequested) {
            const remaining = newCode.substr(editor.document.offsetAt(currentPosition));
            await editor.edit(editBuilder => {
                editBuilder.insert(currentPosition, remaining);
            });
        }

    } catch (error) {
        // Restore original code if cancelled
        if (animationState.cancelRequested && animationState.originalSelection) {
            await editor.edit(editBuilder => {
                editBuilder.replace(animationState.originalSelection!, animationState.originalCode);
            });
            editor.selection = animationState.originalSelection;
        }
    } finally {
        animationState.active = false;
    }
}

// Add this helper function
function showLoadingIndicator(message: string): vscode.Disposable {
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: message,
    cancellable: false
  }, async (progress) => {
    // Simulate progress (optional)
    for (let i = 0; i < 100; i += 10) {
      progress.report({ increment: i });
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });
}


// Extension activation
export function activate(context: vscode.ExtensionContext) {
    // Register main command
    const cleanCommand = vscode.commands.registerCommand('codeCleaner.clean', async () => {
      const loadingIndicator = showLoadingIndicator('Cleaning code... 🪄');
        const selection = getSelectedCode();
        if (!selection) return;

        try {
            const cleanedCode = await cleanCodeWithLLM(selection.code);
            console.log(cleanedCode)
            // Show preview and options
            const choice = await vscode.window.showInformationMessage(
                'Apply cleaned code?', 
                { modal: true }, 
                'Preview', 
                'Apply'
            );

            if (choice === 'Preview') {
                const doc = await vscode.workspace.openTextDocument({
                    content: cleanedCode,
                    language: selection.editor.document.languageId
                });
                await vscode.window.showTextDocument(doc);
                return;
            }

            if (choice === 'Apply') {
                await animateCodeReplacement(selection.editor, cleanedCode);
                vscode.window.showInformationMessage('Code cleaned successfully!');
            }
        } catch (error) {
            vscode.window.showErrorMessage(error.message);
        }
    });

    // Register control commands
    const finishCommand = vscode.commands.registerCommand('codeCleaner.finish', () => {
        if (animationState.active) {
            animationState.finishRequested = true;
        }
    });

    const cancelCommand = vscode.commands.registerCommand('codeCleaner.cancel', () => {
        if (animationState.active) {
            animationState.cancelRequested = true;
        }
    });

    context.subscriptions.push(cleanCommand, finishCommand, cancelCommand);
}

export function deactivate() {}