
all: docker

docker: *.js *.json Dockerfile .dockerignore
	docker build -t lanrat/hass-screenshot .
