from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

from helpers import *

app = FastAPI()

class Docstring(BaseModel):
    file_name: str
    signature: str
    model_name: str

@app.post("/docstring")
async def docstring(body: Docstring):
    data = get_indexed_codebase()
    method, id = get_method_from_signature(body.signature, body.file_name, data, include_method_id=True)
    used_methods = get_used_methods(id, data)
    sys_prompt, user_prompt = get_docstring_prompts(method, used_methods)
    return StreamingResponse(generate_response(body.model_name, sys_prompt, user_prompt), media_type="text/event-stream")

@app.get("/stream")
async def stream_response(model, prompt):
    return StreamingResponse(generate_response(model=model, sys_prompt="you are an assistant", user_prompt=prompt), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=9999, reload=True)
