from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

from helpers import *
from prompts import *

app = FastAPI()

class ReqBody(BaseModel):
    file_name: str
    signature: str
    model_name: str

@app.post("/docstring")
async def docstring(body: ReqBody):
    '''Generate docstring for given method in the given file'''
    method, used_methods = get_methods_for_prompts(body.signature, body.file_name)
    sys_prompt, user_prompt = get_docstring_prompts(method, used_methods)
    return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")

@app.post("/explain")
async def explain(body: ReqBody):
    '''Explain the code in the given signature in the given file'''
    method, used_methods = get_methods_for_prompts(body.signature, body.file_name)
    sys_prompt, user_prompt = get_explain_code_prompts(method, used_methods)
    return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")

@app.post("/related-code")
async def related_code(body: ReqBody):
    method, used_methods = get_methods_for_related_code(body.signature, body.file_name)
    sys_prompt, user_prompt = get_related_code_prompts(method, used_methods)
    return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")

def get_methods_for_related_code(signature, file_name):
    pass

def get_methods_for_prompts(signature, file_name):
    method, method_id = get_method_from_signature(signature, file_name)
    used_methods = get_used_methods(method_id)
    return method, used_methods

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=9999, reload=True)
