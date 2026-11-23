include $(TOPDIR)/rules.mk

LUCI_NAME:=luci-app-cert
PKG_NAME:=luci-app-cert
PKG_VERSION:=26.11.23
PKG_RELEASE:=1
PKG_MAINTAINER:=permails <logo@permails.com>
PKG_LICENSE:=GPL-3.0-or-later

# Bundled acme.sh client release
ACMESH_VERSION:=3.1.7

PKG_SOURCE:=acme.sh-$(ACMESH_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/acmesh-official/acme.sh/tar.gz/$(ACMESH_VERSION)?
PKG_HASH:=1b674f31aab8844e0ed770d4a5907a777d259f58b476c5f9334cc846832081e7
PKG_UNPACK:=

LUCI_TITLE:=ACME Certificate Manager (acme.sh & DNS APIs)
LUCI_DEPENDS:=+luci-base +wget-ssl +ca-bundle +openssl-util +socat

define Package/luci-app-cert/conffiles
/etc/config/cert
/etc/cert
/etc/ssl/cert
endef

define Package/luci-app-cert/prerm
#!/bin/sh
sed -i '\|/etc/init.d/cert|d' /etc/crontabs/root 2>/dev/null || true
endef

define Build/Prepare/luci-app-cert
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/cert/client/dnsapi
	gzip -dc $(DL_DIR)/$(PKG_SOURCE) | $(TAR) -C $(PKG_BUILD_DIR)/root/usr/lib/cert/client --strip-components=1 -xf - acme.sh-$(ACMESH_VERSION)/acme.sh acme.sh-$(ACMESH_VERSION)/dnsapi
	find $(PKG_BUILD_DIR)/root/usr/lib/cert/client/dnsapi -type f ! -name '*.sh' -delete
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/lib/cert/client/acme.sh
	for f in etc/init.d/cert etc/uci-defaults/90_luci-app-cert usr/lib/cert/deploy.sh usr/lib/cert/notify.sh usr/lib/cert/runner.sh usr/lib/cert/update-client.sh usr/libexec/cert-dnsinfo.sh usr/libexec/cert-logread.sh usr/libexec/cert-status.sh; do \
		[ -f "$(PKG_BUILD_DIR)/root/$$$$f" ] && chmod 0755 "$(PKG_BUILD_DIR)/root/$$$$f" || true; \
	done
	[ -f "$(PKG_BUILD_DIR)/root/usr/lib/cert/functions.sh" ] && chmod 0644 "$(PKG_BUILD_DIR)/root/usr/lib/cert/functions.sh" || true
	[ -f "$(PKG_BUILD_DIR)/root/etc/config/cert" ] && chmod 0600 "$(PKG_BUILD_DIR)/root/etc/config/cert" || true
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
