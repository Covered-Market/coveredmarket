# One VM on DigitalOcean + DNS for the domain + a firewall. Nothing else.
# `bin/covered provision` = terraform apply, then `bin/covered deploy`. Inputs: terraform.tfvars (gitignored) or TF_VAR_* (CI).
terraform {
  required_version = ">= 1.6"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

variable "do_token" {
  type      = string
  sensitive = true
}

variable "domain" {
  type        = string
  default     = ""
  description = "optional, e.g. covered.money (nameservers → ns1/ns2/ns3.digitalocean.com). Empty: the site is https://<ip-with-dashes>.sslip.io"
}

variable "region" {
  type    = string
  default = "ams3"
}

variable "size" {
  type    = string
  default = "s-1vcpu-2gb"
}

variable "deploy_pubkey" {
  type        = string
  description = "public half of the deploy key (CI and you ssh in as `deploy` with the private half)"
}

variable "ssh_key_name" {
  type        = string
  default     = ""
  description = "optional: name of an SSH key already in your DigitalOcean account, also allowed in"
}

variable "env_file" {
  type        = string
  default     = ""
  sensitive   = true
  description = "optional production .env. Empty: on first start the VM creates its own testnet contracts and relayer account (infra/cloud/bootstrap)"
}

resource "digitalocean_ssh_key" "deploy" {
  name       = "covered-deploy"
  public_key = var.deploy_pubkey
}

data "digitalocean_ssh_key" "me" {
  count = var.ssh_key_name == "" ? 0 : 1
  name  = var.ssh_key_name
}

resource "digitalocean_droplet" "vm" {
  name     = "covered"
  region   = var.region
  size     = var.size
  image    = "ubuntu-24-04-x64"
  ssh_keys = concat([digitalocean_ssh_key.deploy.id], [for k in data.digitalocean_ssh_key.me : k.id])
  tags     = ["covered"]
  user_data = templatefile("${path.module}/cloud-init.yaml", {
    env_file      = var.env_file
    deploy_pubkey = var.deploy_pubkey
  })
  # The VM is stateless (all state is on NEAR and Bitcoin) but there is no reason to rebuild it for a
  # first-boot or key-list change; a domain change only touches DNS and the next `deploy`.
  lifecycle {
    ignore_changes = [user_data, ssh_keys]
  }
}

resource "digitalocean_domain" "root" {
  count = var.domain == "" ? 0 : 1
  name  = var.domain
}

resource "digitalocean_record" "a" {
  count  = var.domain == "" ? 0 : 1
  domain = digitalocean_domain.root[0].id
  type   = "A"
  name   = "@"
  value  = digitalocean_droplet.vm.ipv4_address
  ttl    = 300
}

resource "digitalocean_record" "wildcard" {
  count  = var.domain == "" ? 0 : 1
  domain = digitalocean_domain.root[0].id
  type   = "A"
  name   = "*"
  value  = digitalocean_droplet.vm.ipv4_address
  ttl    = 300
}

resource "digitalocean_record" "www" {
  count  = var.domain == "" ? 0 : 1
  domain = digitalocean_domain.root[0].id
  type   = "CNAME"
  name   = "www"
  value  = "${var.domain}."
  ttl    = 300
}

resource "digitalocean_firewall" "fw" {
  name        = "covered"
  droplet_ids = [digitalocean_droplet.vm.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

locals {
  site = var.domain != "" ? var.domain : "${replace(digitalocean_droplet.vm.ipv4_address, ".", "-")}.sslip.io"
}

output "ip" {
  value = digitalocean_droplet.vm.ipv4_address
}

output "site" {
  value = local.site
}

output "url" {
  value = "https://${local.site}"
}

output "mainnet_url" {
  value = "https://mainnet.${local.site}"
}

output "ssh" {
  value = "ssh deploy@${digitalocean_droplet.vm.ipv4_address}"
}
