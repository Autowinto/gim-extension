import json
import ollama
import asyncio


def get_chat(model: str, sys_prompt:str, user_prompt:str):
    chat = ollama.chat(
    model=model,
    messages=[{'role':'system','content':sys_prompt},{'role':'user', 'content': user_prompt}],
    stream=True,
)
    return chat

async def generate_response(model:str, sys_prompt:str, user_prompt:str):
    for chunk in get_chat(model, sys_prompt, user_prompt):
        text = chunk['message']['content']
        print(text, end='', flush=True)
        yield f"data: {text}\n\n"
        await asyncio.sleep(0.1)

def get_indexed_codebase():
    with open("analysis-output.json") as f:
        return json.load(f)

def get_method_from_signature(signature:str, file_name:str, json_data: dict):
    full_method = None
    for i in range(len(json_data)):
        if json_data[i]["Document"] == file_name:
            for method in json_data[i]["Methods"]:
                if method["Signature"] == signature:
                    full_method = f'''{method["Signature"]}
{method["Body"]}'''

    return full_method

def json_method_to_string(header, body):
    return header+body

def get_docstring_prompts(method:str):
    '''Input the method, its signature, and its body, formatted to look like they would in code.
        Also input a list in the same format of the methods that the analyzed method calls.'''
    sys_prompt = f'''
You are a C# code expert, and your job is to analyze legacy C# code, and provide documentation comments for methods.

You must be accurate, and good enough for novice developers to understand, and be confident enough to modify the method themself.

You are successful by only outputting the documentation and nothing else.

'''
    user_prompt = f'''
{method}

'''
    return sys_prompt, user_prompt