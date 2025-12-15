from fastapi import FastAPI, HTTPException
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
    if not body.signature:
        raise HTTPException(detail="Missing signature in body", status_code=400)
    if not body.file_name:
        raise HTTPException(detail="Missing file name in body", status_code=400)
    if not body.model_name:
        raise HTTPException(detail="Missing model name in body", status_code=400)
    try:
        method, used_methods = get_methods_for_prompts(body.signature, body.file_name)
        sys_prompt, user_prompt = get_docstring_prompts(method, used_methods)
        return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(
            detail="somehting went wrong, do better", status_code=500
        ) from e

@app.post("/explain")
async def explain(body: ReqBody):
    '''Explain the code in the given signature in the given file'''
    if not body.signature:
        raise HTTPException(detail="Missing signature in body", status_code=400)
    if not body.file_name:
        raise HTTPException(detail="Missing file name in body", status_code=400)
    if not body.model_name:
        raise HTTPException(detail="Missing model name in body", status_code=400)
    try:
        method, used_methods = get_methods_for_prompts(body.signature, body.file_name)
        sys_prompt, user_prompt = get_explain_code_prompts(method, used_methods)
        return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(
            detail="somehting went wrong, do better", status_code=500
        ) from e
@app.post("/related-code")
async def related_code(body: ReqBody):
    if not body.signature:
        raise HTTPException(detail="Missing signature in body", status_code=400)
    if not body.file_name:
        raise HTTPException(detail="Missing file name in body", status_code=400)
    if not body.model_name:
        raise HTTPException(detail="Missing model name in body", status_code=400)
    try:
        method, used_methods = get_methods_for_related_code(body.signature, body.file_name)
        sys_prompt, user_prompt = get_related_code_prompts(method, used_methods)
        return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(detail="somehting went wrong, do better", status_code=500) from e

def get_methods_for_related_code(signature, file_name):
    method, id = get_method_from_signature(signature, file_name)
    related_methods = get_related_methods(id)
    print(related_methods)
    used_methods = []
    for related_method in related_methods["related_methods"]:
        method_id = related_method["method_id"]
        method_signature = related_method["method_signature"]
        document_path = related_method["document_path"]
        used_method_body, used_method_id = get_method_from_signature(method_signature, document_path)
        used_methods.append({"method":used_method_body, "path":document_path})
    return method, used_methods

def get_methods_for_prompts(signature, file_name):
    method, method_id = get_method_from_signature(signature, file_name)
    used_methods = get_used_methods(method_id)
    return method, used_methods

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=9999, reload=True)
