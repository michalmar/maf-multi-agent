# How to add user to system

There are two user groups:
- maf-multi-agent-Data-Users - for aceess to databases (Fabric and SQL DB)
- maf-multi-agent-App-Users - for access to application features


## Flow

1. Create user in Entra ID (or invite external user)
2. Add user to one of the groups (maf-multi-agent-Data-Users or maf-multi-agent-App-Users)

Onboarding automation:
```sh
 ./deploy/add_user.sh alice@contoso.com              # Add to both groups
 ./deploy/add_user.sh alice@contoso.com --app-only   # App access only
 ./deploy/add_user.sh alice@contoso.com --remove      # Remove access
```