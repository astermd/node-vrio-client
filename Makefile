.PHONY: install lint lint-fix analyse test build gate

install:
	npm ci

lint:
	npm run lint

lint-fix:
	npm run lint:fix

analyse:
	npm run typecheck

test:
	npm run test

build:
	npm run build

gate:
	npm run gate
