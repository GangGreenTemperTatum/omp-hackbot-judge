# Disposable test box: its own HOME, omp install and ~/.omp, sharing nothing with the host's omp.
FROM oven/bun:1.4-debian

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git jq \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash tester
USER tester
WORKDIR /home/tester

# Pin the omp release under test; the installer checks the binary's SHA-256.
ARG OMP_REF=v19.2.1
RUN curl -fsSL https://omp.sh/install | sh -s -- --binary --ref "${OMP_REF}"
ENV PATH="/home/tester/.local/bin:/home/tester/.bun/bin:${PATH}"
