# Heroku requires the process to bind to its dynamically-assigned $PORT.
# Evolution API listens on SERVER_PORT, loaded from a baked-in /evolution/.env
# file via dotenv at startup — that overrides any shell-exported SERVER_PORT,
# so patch the file itself before boot (Heroku only provides $PORT at runtime,
# not build time, so this has to happen in CMD, not in a RUN step).
FROM evoapicloud/evolution-api:v2.3.7
CMD ["/bin/bash", "-c", "sed -i \"s/^SERVER_PORT=.*/SERVER_PORT=${PORT:-8080}/\" .env && . ./Docker/scripts/deploy_database.sh && npm run start:prod"]
