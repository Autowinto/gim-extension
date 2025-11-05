import json
import ollama
import asyncio
import requests
from typing import List
from typing import List, AsyncGenerator

async def get_chat_stream(model: str, sys_prompt:str, user_prompt:str):
    client = ollama.AsyncClient()
    stream = await client.chat(
        model=model,
        messages=[{'role': 'system', 'content': sys_prompt}, {'role': 'user', 'content': user_prompt}],
        stream=True,
    )
    return stream

async def generate_response(model: str, sys_prompt: str, user_prompt: str) -> AsyncGenerator[str, None]:
    data = ""
    stream = await get_chat_stream(model, sys_prompt, user_prompt)
    async for chunk in stream:
        content = chunk.get('message', {}).get('content')
        if content:
            # print(content, end='', flush=True)
            data+=content
            yield f"data: {json.dumps({'token': content})}\n\n"
            # yield f"data: {content}\n\n"
    print(data)
def get_indexed_codebase():
    #response = requests.get("http://127.0.0.1:8000/fetch-all")
    #if response.status_code == 200:
    #    return response.json()
    #else:
    #    return {"error": "Failed to fetch codebase"} 
    with open("./sample_data.json") as f:
        d = json.load(f)
        return d
    
def get_used_methods(method_id, data):
    '''returns the methods called by the method with given id'''
    callees = ""
    for entry in data["data"]:
        if entry["method_id"] == method_id:
            for callee in entry["callees"]:
                callees+=(get_method_from_signature(callee["signature"],entry["document_path"],data)+"\n")
    return callees

def get_method_from_signature(signature:str, file_name:str, json_data: dict, include_method_id=False):
    full_method = None
    data: list[FetchAllResponse] = json_data["data"]
    for i in range(len(data)):
        method = data[i]
        if method["document_path"] == file_name and method["method_signature"] == signature:
            full_method = f'''{method["method_signature"]}
{method["method_body"]}'''
            if include_method_id:
                return full_method, method["method_id"]
            return full_method

def json_method_to_string(header, body):
    return header+body

def get_docstring_prompts(method:str, used_methods: str):
    '''Input the method, its signature, and its body, formatted to look like they would in code.
        Also input a list in the same format of the methods that the analyzed method calls.'''
    sys_prompt = f'''
You are a C# code expert, and your job is to analyze legacy C# code, and provide a documentation comment for a given method.

You must be accurate, and good enough for novice developers to understand, and be confident enough to modify the method themself.
{"" if used_methods == "" else "\nYou are provided with a list of methods used in the method you are analyzing for a greater understanding of what it does.\n"}
You are successful by only outputting the documentation for the first given method and nothing else.

'''
    user_prompt = f'''
{method}\n
'''
    if used_methods != "":
        user_prompt+=f'''You will now be provided with the methods called by the method you are providing documentation for. Do not analyze these. use them simply for understanding.
        {used_methods}
'''
    return sys_prompt, user_prompt


class CallsResponseBody():
    id: int # Method id 
    signature: str

class FetchAllResponse():
    project_id: int
    project_name: str
    document_id: int
    document_path: str
    class_id: int
    class_name: str
    method_id: int
    method_name: str
    method_signature: str
    method_body: str
    callees: List[CallsResponseBody] = [] # Methods that this method calls
    callers: List[CallsResponseBody] = [] # Methods that call this method
