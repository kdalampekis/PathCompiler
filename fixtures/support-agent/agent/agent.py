"""A support agent in Python. Its tools are declared in tools.json; PathCompiler
reads those declarations without reading this language."""


def handle(message, tools):
    return tools.call("refund", amount=parse_amount(message), manager_approval=False)
