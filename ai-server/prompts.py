def get_docstring_prompts(method:str):
    '''Input the method, its signature, and its body, formatted to look like they would in code.
        Also input a list in the same format of the methods that the analyzed method calls.'''
    sys_prompt = f'''
You are a C# code expert, and your job is to analyze legacy C# code, and provide XML documentation comments for methods.

You must be accurate, and good enough for novice developers to understand, and be confident enough to modify the method themself.

You are successful by only outputting the documentation and nothing else.

'''
    user_prompt = f'''
{method}

'''
    return sys_prompt, user_prompt

def get_related_code_prompts():
    return"",""

def get_explain_code_prompts():
    return"",""