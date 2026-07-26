# terra-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _terra_user_zdotdir="${TERRA_USER_ZDOTDIR:-$HOME}"
  [ -f "$_terra_user_zdotdir/.zprofile" ] && source "$_terra_user_zdotdir/.zprofile"
  unset _terra_user_zdotdir
}
:
