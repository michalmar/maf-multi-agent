# How to add user to system

There are two user groups:
- maf-multi-agent-Data-Users - for access to databases (Fabric and SQL DB)
- maf-multi-agent-App-Users - for access to application features


## Flow

1. Run the onboarding script with the user's email address.
2. The script finds the user, or creates/invites the missing user as an Entra ID `Member`.
3. If given name, surname, or display name are missing, the script infers them from the email local part. For example, `alice.smith@contoso.com` becomes `Alice Smith`.
4. The script adds the user to one of the groups (`maf-multi-agent-Data-Users` or `maf-multi-agent-App-Users`).

Onboarding automation:
```sh
 ./deploy/add_user.sh alice@contoso.com              # Add to both groups
 ./deploy/add_user.sh alice@contoso.com --display-name "Alice Smith"
 ./deploy/add_user.sh alice@contoso.com --app-only   # App access only
 ./deploy/add_user.sh alice@contoso.com --remove      # Remove access
```

By default, missing external users are invited with `invitedUserType=Member`. Set `USER_TEMP_PASSWORD` to create a local tenant Member account instead, or set `INVITE_REDIRECT_URL` to override the invitation redemption URL.

For a file containing lines like `Alice Smith <alice@contoso.com>`, run:

```sh
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  email="${line##*<}"
  email="${email%>}"
  display_name="${line%% <*}"
  ./deploy/add_user.sh "$email" --display-name "$display_name"
done < docs/users-20260511.txt
```