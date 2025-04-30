

all: build install

build:
	rmdir dist /s /q
	python -m build

install:
	pip install $(wildcard dist/*.whl) --force-reinstall --no-deps

test:
	python test/test.py