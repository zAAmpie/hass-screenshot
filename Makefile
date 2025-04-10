
all: docker

docker: *.js *.json Dockerfile .dockerignore
	docker build -t zaampie/hass-dashboard-screenshot:latest .

push:
	docker push zaampie/hass-dashboard-screenshot:latest
