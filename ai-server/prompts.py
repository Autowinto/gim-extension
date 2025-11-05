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

def get_related_code_prompts():
    return"",""

def get_explain_code_prompts(method:str, used_methods: str):
    '''Input the method, its signature, and its body, formatted to look like they would in code.
        Also input a list in the same format of the methods that the analyzed method calls.'''
    sys_prompt = f'''
You are a C# code expert, and your job is to analyze legacy C# code, and explain so a novice C# developer would understand it.

You must be accurate, and good enough for novice developers to understand, and be confident enough to modify the method themself.

{"" if used_methods == "" else "\nYou are provided with a list of methods used in the method you are analyzing for a greater understanding of what it does.\n"}
You are successful by giving a consice, exact, and useful explanation of the code.
The user will now give you code that you will provide a description of.
'''
    user_prompt = f'''
Here is the method you must analyze and explain:
-----------------------------------------------
{method}
-----------------------------------------------\n
'''
    if used_methods != "":
        user_prompt+=f'''You will now be provided with the methods called by the method you are providing documentation for. Do not analyze these. use them simply for understanding.
        {used_methods}
'''
    return sys_prompt, user_prompt