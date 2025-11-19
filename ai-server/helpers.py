import json
import ollama
import asyncio
import requests
from typing import List
from typing import List, AsyncGenerator

API_BASE = "http://localhost:8000/"

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
            data+=content
            yield f"data: {json.dumps({'token': content})}\n\n"
    
def get_used_methods(method_id):
    data = requests.get(f"{API_BASE}used-methods/{method_id}")
    return data.json().values()

def get_method_from_signature(signature:str, file_name:str) ->tuple[str, int]: 
    data = requests.get(API_BASE+"method-from-signature", params={
        "signature":signature,
        "file_name":file_name
    })
    return data.json().values() #method, id

def json_method_to_string(header, body):
    return header+body

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
